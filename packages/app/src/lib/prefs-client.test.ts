// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPrefs,
  fetchPrefs,
  hasLocalPrefs,
  pushPrefs,
  putPrefs,
  readLocalPrefs,
  syncPrefs,
} from "./prefs-client.ts";
import { browserStore, loadSettings, saveSettings } from "./storage.ts";
import { THEME_KEY } from "./theme.ts";
import { STYLE_KEY } from "./visual-style.ts";

const prefs = { theme: "dark", style: "simple", shuffleChoices: true } as const;

type Call = { url: string; method: string; body: unknown };

/** アカウントの設定(null は保存なし)を持つ、通信の代わり。取得も保存も記録する。 */
function stubServer(initial: unknown, options: { getOk?: boolean; putOk?: boolean } = {}) {
  const calls: Call[] = [];
  let stored = initial;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (method === "PUT") {
        if (options.putOk === false) return { ok: false, status: 503, json: async () => ({}) };
        stored = body;
        return { ok: true, status: 200, json: async () => ({ status: "saved" }) };
      }
      if (options.getOk === false) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ prefs: stored }) };
    }),
  );
  return { calls, stored: () => stored };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-style");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("端末の設定", () => {
  it("何も保存していない端末_設定なしとして扱い_既定を返す", () => {
    expect(hasLocalPrefs(browserStore())).toBe(false);
    expect(readLocalPrefs(browserStore())).toEqual({ theme: "system", style: "rich", shuffleChoices: false });
  });

  it("どれか 1 つでも保存している_設定ありとして扱う", () => {
    for (const key of [THEME_KEY, STYLE_KEY, "mokumoku:v1:settings"]) {
      localStorage.clear();
      localStorage.setItem(key, key === "mokumoku:v1:settings" ? '{"shuffleChoices":true}' : "dark");
      expect(hasLocalPrefs(browserStore()), key).toBe(true);
    }
  });

  it("反映する_画面と端末の保存先に書き_解答の表示のしかたは変えない", () => {
    saveSettings(browserStore(), { shuffleChoices: false, reveal: "each" });
    applyPrefs(browserStore(), prefs);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-style")).toBe("simple");
    expect(readLocalPrefs(browserStore())).toEqual(prefs);
    expect(loadSettings(browserStore())).toEqual({ shuffleChoices: true, reveal: "each" });
  });

  it("端末に従うを反映する_data-theme の属性を外す", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    applyPrefs(browserStore(), { ...prefs, theme: "system" });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("アカウントとの通信", () => {
  it("取得_形が正しければ返し_保存していなければ null_失敗・壊れた応答は null", async () => {
    stubServer(prefs);
    expect(await fetchPrefs()).toEqual({ prefs });
    stubServer(null);
    expect(await fetchPrefs()).toEqual({ prefs: null });
    stubServer({ theme: "blue", style: "rich", shuffleChoices: false });
    expect(await fetchPrefs()).toBeNull();
    stubServer(prefs, { getOk: false });
    expect(await fetchPrefs()).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    expect(await fetchPrefs()).toBeNull();
  });

  it("保存_PUT で 3 つの値だけを送る_失敗したら false", async () => {
    const server = stubServer(null);
    expect(await putPrefs(prefs)).toBe(true);
    expect(server.calls[0]).toEqual({ url: "/api/history/prefs", method: "PUT", body: prefs });
    stubServer(null, { putOk: false });
    expect(await putPrefs(prefs)).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    expect(await putPrefs(prefs)).toBe(false);
  });
});

describe("ログイン後の同期", () => {
  it("アカウントに設定がある_端末に反映する(別の端末で選んだ設定を引き継ぐ)", async () => {
    const server = stubServer(prefs);
    expect(await syncPrefs(browserStore())).toBe(true);
    expect(readLocalPrefs(browserStore())).toEqual(prefs);
    expect(document.documentElement.getAttribute("data-style")).toBe("simple");
    // アカウントの設定を、端末の設定で上書きしない
    expect(server.calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("アカウントの設定と端末の設定が同じ_変わったと報告しない", async () => {
    stubServer(prefs);
    applyPrefs(browserStore(), prefs);
    expect(await syncPrefs(browserStore())).toBe(false);
  });

  it("アカウントと端末の設定が違う_アカウントを正とする", async () => {
    const server = stubServer(prefs);
    applyPrefs(browserStore(), { theme: "light", style: "rich", shuffleChoices: false });
    await syncPrefs(browserStore());
    expect(readLocalPrefs(browserStore())).toEqual(prefs);
    expect(server.stored()).toEqual(prefs);
  });

  it("アカウントに設定がなく端末にある_初回にアカウントへ上げる", async () => {
    const server = stubServer(null);
    applyPrefs(browserStore(), prefs);
    document.documentElement.removeAttribute("data-theme");
    expect(await syncPrefs(browserStore())).toBe(false);
    expect(server.calls.filter((c) => c.method === "PUT")).toEqual([
      { url: "/api/history/prefs", method: "PUT", body: prefs },
    ]);
  });

  it("どちらにも設定がない_何も保存しない(既定のまま)", async () => {
    const server = stubServer(null);
    await syncPrefs(browserStore());
    expect(server.calls.filter((c) => c.method === "PUT")).toEqual([]);
    expect(hasLocalPrefs(browserStore())).toBe(false);
  });

  it("取得できない_何も変えない(端末の設定を消さず_アカウントにも送らない)", async () => {
    const server = stubServer(null, { getOk: false });
    applyPrefs(browserStore(), prefs);
    expect(await syncPrefs(browserStore())).toBe(false);
    expect(readLocalPrefs(browserStore())).toEqual(prefs);
    expect(server.calls.filter((c) => c.method === "PUT")).toEqual([]);
  });
});

describe("変更したあとの送信", () => {
  it("端末の設定をアカウントへ送る", async () => {
    const server = stubServer(null);
    applyPrefs(browserStore(), prefs);
    await pushPrefs(browserStore());
    expect(server.stored()).toEqual(prefs);
  });

  it("送れなくても例外にしない(端末の設定は、そのまま)", async () => {
    stubServer(null, { putOk: false });
    applyPrefs(browserStore(), prefs);
    await expect(pushPrefs(browserStore())).resolves.toBeUndefined();
    expect(readLocalPrefs(browserStore())).toEqual(prefs);
  });
});
