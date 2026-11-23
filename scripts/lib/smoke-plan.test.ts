import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { humanChecklist } from "./deploy-plan.ts";
import {
  AUTOMATED_CHECKLIST_ITEMS,
  checkCookieAttributes,
  containsNoValues,
  disposableEmail,
  disposablePassword,
  formatSmokeTable,
  humanItemsAfterSmoke,
  judgeUnauthenticated,
  parseSmokeTable,
  withDisposableUser,
} from "./smoke-plan.ts";

describe("使い捨てのユーザーの値", () => {
  it("実行ごとの値_予約済みのドメインで、パスワードは大文字・小文字・数字を含む12文字以上", () => {
    expect(disposableEmail(1, "ab12")).toBe("smoke-1-ab12@example.com");
    const password = disposablePassword("0123456789ab");
    expect(password.length).toBeGreaterThanOrEqual(12);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
  });
});

describe("judgeUnauthenticated", () => {
  it("想定どおりの応答_3項目とも成功する", () => {
    const items = judgeUnauthenticated({ login: 200, api: 401, direct: 403 });
    expect(items.map((i) => i.status)).toEqual(["ok", "ok", "ok"]);
  });

  it("未ログインのAPIが200_失敗にする", () => {
    expect(judgeUnauthenticated({ login: 200, api: 200, direct: 403 })[1]?.status).toBe("fail");
  });

  it("Function URLが未設定_省略にして人の確認へ回す", () => {
    const direct = judgeUnauthenticated({ login: 200, api: 401, direct: null })[2];
    expect(direct?.status).toBe("skip");
  });

  it("合言葉なしの直接のアクセスが通る_失敗にする", () => {
    expect(judgeUnauthenticated({ login: 200, api: 401, direct: 200 })[2]?.status).toBe("fail");
  });
});

describe("checkCookieAttributes", () => {
  const good = ["mokumoku_id", "mokumoku_access", "mokumoku_refresh"].map((name) => ({
    name,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }));

  it("3つとも属性がそろう_成功する", () => {
    expect(checkCookieAttributes(good).status).toBe("ok");
  });

  it("Secureがない_どのCookieかだけを示して失敗する", () => {
    const item = checkCookieAttributes(good.map((c) => (c.name === "mokumoku_id" ? { ...c, secure: false } : c)));
    expect(item.status).toBe("fail");
    expect(item.note).toBe("mokumoku_id の Secure がない");
  });

  it("Cookieが欠ける_失敗する", () => {
    expect(checkCookieAttributes(good.slice(0, 2)).note).toBe("mokumoku_refresh がない");
  });
});

describe("withDisposableUser", () => {
  const make = (overrides: Partial<Record<"create" | "setPassword" | "remove", () => Promise<void>>> = {}) => {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        create: async () => {
          calls.push("create");
          await overrides.create?.();
        },
        setPassword: async () => {
          calls.push("setPassword");
          await overrides.setPassword?.();
        },
        remove: async () => {
          calls.push("remove");
          await overrides.remove?.();
        },
      },
    };
  };

  it("使い終わる_成功しても消す", async () => {
    const { deps, calls } = make();
    const out = await withDisposableUser(deps, "e", "p", async () => "done");
    expect(out.result).toBe("done");
    expect(calls).toEqual(["create", "setPassword", "remove"]);
  });

  it("使う処理が失敗_失敗を返し、それでも消す", async () => {
    const { deps, calls } = make();
    const out = await withDisposableUser(deps, "e", "p", async () => {
      throw new Error("x");
    });
    expect(out.error).toBeInstanceOf(Error);
    expect(calls.at(-1)).toBe("remove");
  });

  it("パスワードの設定で失敗_使う処理に進まず、消す", async () => {
    const { deps, calls } = make({
      setPassword: async () => {
        throw new Error("x");
      },
    });
    let ran = false;
    const out = await withDisposableUser(deps, "e", "p", async () => {
      ran = true;
    });
    expect(ran).toBe(false);
    expect(out.error).toBeInstanceOf(Error);
    expect(calls).toEqual(["create", "setPassword", "remove"]);
  });

  it("消しが失敗_使った結果を隠さず、消しの失敗を別に返す", async () => {
    const { deps } = make({
      remove: async () => {
        throw new Error("x");
      },
    });
    const out = await withDisposableUser(deps, "e", "p", async () => 1);
    expect(out.result).toBe(1);
    expect(out.removeError).toBeInstanceOf(Error);
  });
});

describe("値の非出力", () => {
  it("表の出力_項目と成否と属性だけで、渡した値を含まない", () => {
    const email = disposableEmail(1, "ab12");
    const password = disposablePassword("0123456789ab");
    const table = formatSmokeTable([
      ...judgeUnauthenticated({ login: 200, api: 401, direct: null }),
      checkCookieAttributes([]),
    ]);
    expect(containsNoValues(table, [email, password])).toBe(true);
    expect(containsNoValues(`x ${password} y`, [email, password])).toBe(false);
  });

  it("空の値_数えない", () => {
    expect(containsNoValues("abc", [""])).toBe(true);
  });
});

describe("自動で確かめた項目", () => {
  it("項目名_デプロイ後の画面確認の文書の項目と一致する", () => {
    const doc = readFileSync(new URL("../../docs/post-deploy-smoke.md", import.meta.url), "utf8");
    const items = humanChecklist(doc);
    for (const name of AUTOMATED_CHECKLIST_ITEMS) expect(items, name).toContain(name);
  });
});

describe("humanItemsAfterSmoke", () => {
  const items = ["サインイン", "新規登録と退会", "Cookie", "主要なボタン"];
  const ok = { name: "x", status: "ok" as const, note: "" };

  it("全項目が成功_自動で確かめた項目を人の一覧から除く", () => {
    expect(humanItemsAfterSmoke(items, [ok])).toEqual(["新規登録と退会", "主要なボタン"]);
  });

  it("失敗か省略がある_一覧をそのまま残す", () => {
    expect(humanItemsAfterSmoke(items, [ok, { ...ok, status: "skip" }])).toEqual(items);
    expect(humanItemsAfterSmoke(items, [ok, { ...ok, status: "fail" }])).toEqual(items);
  });

  it("スモークを実行していない_一覧をそのまま残す", () => {
    expect(humanItemsAfterSmoke(items, [])).toEqual(items);
  });
});

describe("parseSmokeTable", () => {
  it("表の出力_項目に戻せて_表でない行は読み飛ばす", () => {
    const items = judgeUnauthenticated({ login: 200, api: 401, direct: null });
    expect(parseSmokeTable(`前置き\n${formatSmokeTable(items)}\n`).map((i) => [i.name, i.status])).toEqual(
      items.map((i) => [i.name, i.status]),
    );
  });
});
