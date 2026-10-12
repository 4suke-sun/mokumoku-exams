import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, MAX_PREFS_BODY_BYTES, PrefsSchema, prefsEqual } from "./prefs.ts";
import {
  ownerTag,
  PREFS_COOKIE,
  parsePrefsCookie,
  prefsCookieValue,
  prefsSetCookie,
  readPrefsCookieValue,
} from "./prefs-cookie.ts";
import { prefsForRequest } from "./prefs-server.ts";
import { THEME_INIT_SCRIPT } from "./theme.ts";
import { STYLE_INIT_SCRIPT } from "./visual-style.ts";

const prefs = { theme: "dark", style: "simple", shuffleChoices: true } as const;

describe("PrefsSchema", () => {
  it("正しい設定_通す", () => {
    expect(PrefsSchema.safeParse(prefs).success).toBe(true);
    expect(PrefsSchema.safeParse(DEFAULT_PREFS).success).toBe(true);
  });

  it("知らない値・足りない項目・未知の項目・型の違い_断る", () => {
    for (const bad of [
      { ...prefs, theme: "blue" },
      { ...prefs, style: "fancy" },
      { ...prefs, shuffleChoices: "yes" },
      { theme: "dark", style: "simple" },
      { ...prefs, sub: "other-user" },
      { ...prefs, extra: 1 },
      null,
      [],
    ]) {
      expect(PrefsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("既定_端末に従い・リッチ・シャッフルなし", () => {
    expect(DEFAULT_PREFS).toEqual({ theme: "system", style: "rich", shuffleChoices: false });
    expect(MAX_PREFS_BODY_BYTES).toBeGreaterThan(JSON.stringify(prefs).length);
  });

  it("等しさ_3 つの値で比べる", () => {
    expect(prefsEqual(prefs, { ...prefs })).toBe(true);
    expect(prefsEqual(prefs, { ...prefs, style: "rich" })).toBe(false);
  });
});

describe("設定の Cookie", () => {
  it("書いて読む_持ち主が同じなら元の設定に戻る", () => {
    expect(parsePrefsCookie(prefsCookieValue("user-a", prefs), "user-a")).toEqual(prefs);
    expect(parsePrefsCookie(prefsCookieValue("user-a", DEFAULT_PREFS), "user-a")).toEqual(DEFAULT_PREFS);
  });

  it("別のアカウント_持ち主が違うので使わない", () => {
    expect(parsePrefsCookie(prefsCookieValue("user-a", prefs), "user-b")).toBeNull();
  });

  it("値に利用者の識別子そのものを入れない(短い照合だけ)", () => {
    const value = prefsCookieValue("user-a-secret-sub", prefs);
    expect(value).not.toContain("user-a-secret-sub");
    expect(value.split(".")[1]).toBe(ownerTag("user-a-secret-sub"));
    expect(ownerTag("user-a")).toHaveLength(16);
    expect(ownerTag("user-a")).not.toBe(ownerTag("user-b"));
  });

  it("壊れた値・知らない値・形の違う値_使わない", () => {
    const owner = ownerTag("user-a");
    for (const value of [
      undefined,
      "",
      "garbage",
      `v2.${owner}.dark.simple.1`,
      `v1.${owner}.blue.simple.1`,
      `v1.${owner}.dark.fancy.1`,
      `v1.${owner}.dark.simple.2`,
      `v1.${owner}.dark.simple`,
      `v1.${owner}.dark.simple.1.extra`,
      "v1..dark.simple.1",
    ]) {
      expect(parsePrefsCookie(value, "user-a"), String(value)).toBeNull();
    }
  });

  it("Set-Cookie_サーバーだけが読み(HttpOnly)・別サイトからは送られず・本番では Secure", () => {
    const plain = prefsSetCookie("user-a", prefs, false);
    expect(plain).toContain(`${PREFS_COOKIE}=`);
    expect(plain).toContain("HttpOnly");
    expect(plain).toContain("SameSite=Lax");
    expect(plain).toContain("Path=/");
    expect(plain).toContain("Max-Age=31536000");
    expect(plain).not.toContain("Secure");
    expect(prefsSetCookie("user-a", prefs, true)).toContain("Secure");
  });

  it("Cookie ヘッダーから取り出す_ほかの Cookie に混ざっていても", () => {
    const value = prefsCookieValue("user-a", prefs);
    expect(readPrefsCookieValue(`a=1; ${PREFS_COOKIE}=${value}; b=2`)).toBe(value);
    expect(readPrefsCookieValue("a=1; b=2")).toBeUndefined();
    expect(readPrefsCookieValue(null)).toBeUndefined();
  });
});

describe("リクエストに適用する設定", () => {
  const deps = (sub: string | null, fail = false) => ({
    verifier: {
      async verifyIdToken(token: string) {
        if (fail) throw new Error("boom");
        return token === "token" && sub ? { sub, groups: [] } : null;
      },
    },
    provider: {
      async refresh() {
        throw new Error("unavailable");
      },
    },
    secure: false,
  });
  const header = (owner: string, extra = "") =>
    `mokumoku_id=token; ${PREFS_COOKIE}=${prefsCookieValue(owner, prefs)}${extra}`;

  it("ログイン中で持ち主が一致_設定を返す", async () => {
    expect(await prefsForRequest(header("user-a"), deps("user-a") as never)).toEqual(prefs);
  });

  it("別のアカウントの Cookie_反映しない", async () => {
    expect(await prefsForRequest(header("user-a"), deps("user-b") as never)).toBeNull();
  });

  it("未ログイン・壊れたトークン・設定の Cookie がない_反映しない", async () => {
    expect(
      await prefsForRequest(`${PREFS_COOKIE}=${prefsCookieValue("user-a", prefs)}`, deps("user-a") as never),
    ).toBeNull();
    expect(await prefsForRequest("mokumoku_id=forged", deps("user-a") as never)).toBeNull();
    expect(await prefsForRequest("mokumoku_id=token", deps("user-a") as never)).toBeNull();
    expect(await prefsForRequest(null, deps("user-a") as never)).toBeNull();
  });

  it("検証が失敗した_反映しない(通す側には倒さない)", async () => {
    expect(await prefsForRequest(header("user-a"), deps("user-a", true) as never)).toBeNull();
  });

  it("書き換えた Cookie_別の利用者の持ち主の値では反映しない", async () => {
    // 自分の設定の値に、別の利用者の持ち主の照合を付けても、自分の識別子と合わないので使われない
    const forged = `mokumoku_id=token; ${PREFS_COOKIE}=${prefsCookieValue("victim", prefs)}`;
    expect(await prefsForRequest(forged, deps("attacker") as never)).toBeNull();
  });
});

describe("初回描画の前のスクリプト", () => {
  it("サーバーが設定を反映したとき(data-prefs)_端末の値で上書きしない", () => {
    for (const script of [THEME_INIT_SCRIPT, STYLE_INIT_SCRIPT]) {
      expect(script).toContain('hasAttribute("data-prefs")');
    }
  });

  it("実行する_data-prefs があれば端末の値を使わず_なければ使う", () => {
    const run = (script: string, attrs: Record<string, string>, stored: Record<string, string>) => {
      const attributes = new Map(Object.entries(attrs));
      const documentElement = {
        hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      };
      new Function("document", "localStorage", script)(
        { documentElement },
        { getItem: (key: string) => stored[key] ?? null },
      );
      return attributes;
    };
    const stored = { "mokumoku:v1:theme": "light", "mokumoku:v1:style": "simple" };
    const server = run(
      `${THEME_INIT_SCRIPT}${STYLE_INIT_SCRIPT}`,
      { "data-prefs": "1", "data-theme": "dark", "data-style": "rich" },
      stored,
    );
    expect(server.get("data-theme")).toBe("dark");
    expect(server.get("data-style")).toBe("rich");
    const local = run(`${THEME_INIT_SCRIPT}${STYLE_INIT_SCRIPT}`, {}, stored);
    expect(local.get("data-theme")).toBe("light");
    expect(local.get("data-style")).toBe("simple");
  });
});
