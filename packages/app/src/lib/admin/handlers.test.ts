import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "@/lib/auth/types.ts";
import { type ManagedUser, type UserAdmin, UserAdminError } from "@/lib/auth/user-admin.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { fakeTable } from "@/lib/history/table-double.ts";
import { type AuditLog, auditKey, createDynamoAuditLog, createMemoryAuditLog } from "./audit.ts";
import { type AdminDeps, handleDisableUser, handleListUsers, MAX_ADMIN_BODY_BYTES } from "./handlers.ts";

const ORIGIN = "http://localhost";
const NOW = Date.parse("2026-10-12T00:00:00.000Z");

/** トークンの文字列から利用者を決める検証。`admin-` で始まる利用者は、管理者のグループに入っている */
const verifier: TokenVerifier = {
  async verifyIdToken(token) {
    if (!token.startsWith("token-")) return null;
    const sub = token.slice("token-".length);
    return { sub, groups: sub.startsWith("admin-") ? ["admins"] : [] };
  },
};
const noRefresh = {
  async refresh() {
    throw new Error("unavailable");
  },
} as unknown as AuthProvider;

const ADMIN = "admin-1";
const asUser = (sub: string) => `mokumoku_id=token-${sub}`;

function memoryUsers(initial: ManagedUser[] = []) {
  const users = initial.map((u) => ({ ...u }));
  const admin: UserAdmin = {
    async listUsers() {
      return users.map((u) => ({ ...u }));
    },
    async disableUser(username) {
      const user = users.find((u) => u.username === username);
      if (!user) throw new UserAdminError("not-found");
      user.enabled = false;
    },
    async getSignUpState() {
      return null;
    },
    async deleteStaleUnconfirmed() {
      return false;
    },
  };
  return { users, admin };
}

const user = (username: string, email: string, createdAt: string | null): ManagedUser => ({
  username,
  email,
  status: "CONFIRMED",
  enabled: true,
  createdAt,
});

function setup(initial: ManagedUser[] = [], audit: AuditLog = createMemoryAuditLog()) {
  const { users, admin } = memoryUsers(initial);
  const deps: AdminDeps = {
    auth: { verifier, provider: noRefresh, secure: false },
    users: admin,
    audit,
    now: () => NOW,
  };
  return { users, deps, audit };
}

const get = (query = "", headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/admin/users${query}`, { headers });

function post(path: string, value: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(value),
  });
}
const disable = (value: unknown, headers: Record<string, string> = {}) =>
  post("/api/admin/users/disable", value, headers);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("管理者の API の認可", () => {
  it("未ログイン・壊れたトークン・管理者でない利用者_どの操作も 403 で断り_何も変えない", async () => {
    const { users, deps } = setup([user("user-9", "nine@example.com", null)]);
    for (const cookie of [undefined, "mokumoku_id=forged", asUser("learner")]) {
      const headers: Record<string, string> = cookie ? { cookie } : {};
      expect((await handleListUsers(get("", headers), deps)).status).toBe(403);
      expect((await handleDisableUser(disable({ username: "user-9" }, headers), deps)).status).toBe(403);
    }
    expect(users).toHaveLength(1);
    expect(users[0]?.enabled).toBe(true);
  });

  it("検証の処理が失敗した_403 で断る(通す側には倒さない)", async () => {
    const { deps } = setup();
    deps.auth.verifier = {
      async verifyIdToken() {
        throw new Error("boom");
      },
    };
    expect((await handleListUsers(get("", { cookie: asUser(ADMIN) }), deps)).status).toBe(403);
  });
});

describe("利用者の一覧", () => {
  it("作成日の新しい順に返し_操作している管理者自身に印を付ける", async () => {
    const { deps } = setup([
      user("user-old", "old@example.com", "2026-01-01T00:00:00.000Z"),
      user(ADMIN, "admin@example.com", "2026-03-01T00:00:00.000Z"),
      user("user-new", "new@example.com", "2026-05-01T00:00:00.000Z"),
    ]);
    const response = await handleListUsers(get("", { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { users } = (await response.json()) as { users: (ManagedUser & { self: boolean })[] };
    expect(users.map((u) => [u.username, u.self])).toEqual([
      ["user-new", false],
      [ADMIN, true],
      ["user-old", false],
    ]);
    expect(users[0]).toMatchObject({ email: "new@example.com", status: "CONFIRMED", enabled: true });
  });

  it("問い合わせのパラメーター_受け付けない", async () => {
    const { deps } = setup();
    for (const query of ["?sub=other", "?user=x", "?limit=1"]) {
      expect((await handleListUsers(get(query, { cookie: asUser(ADMIN) }), deps)).status, query).toBe(400);
    }
  });

  it("管理 API の失敗_種類だけを返す", async () => {
    const { deps } = setup();
    deps.users.listUsers = async () => {
      throw new Error("detail");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleListUsers(get("", { cookie: asUser(ADMIN) }), deps);
    const lines = log.mock.calls.map((call) => call.map(String).join(" "));
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "api-failure", path: "/api/admin/users", status: 503, error: "Error" },
    ]);
    expect(lines.join("\n")).not.toContain("detail");
  });

  it("種類のわかる失敗_503 でなければ記録しない", async () => {
    const { deps } = setup();
    deps.users.listUsers = async () => {
      throw new UserAdminError("limit-exceeded");
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleListUsers(get("", { cookie: asUser(ADMIN) }), deps);
    const calls = log.mock.calls.length;
    log.mockRestore();
    expect(response.status).toBe(429);
    expect(calls).toBe(0);
  });
});

describe("一覧のメールアドレス", () => {
  it("確認待ちの利用者_Cognito の状態のまま一覧に返す", async () => {
    const { deps } = setup([{ ...user("user-2", "two@example.com", null), status: "UNCONFIRMED" }]);
    const response = await handleListUsers(get("", { cookie: asUser(ADMIN) }), deps);
    const { users } = (await response.json()) as { users: ManagedUser[] };
    expect(users[0]).toMatchObject({ email: "two@example.com", status: "UNCONFIRMED" });
  });

  it("メールアドレス_一覧が成功しても失敗しても_サーバーのログに出さない", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const { deps } = setup([user("user-9", "secret@example.com", null)]);
    const cookie = asUser(ADMIN);
    await handleListUsers(get("", { cookie }), deps);
    deps.users.listUsers = async () => {
      throw new Error("secret@example.com");
    };
    await handleListUsers(get("", { cookie }), deps);
    // 失敗の記録(経路・状態・例外の名前)は出るが、メールアドレスは含まない
    const output = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(" "))).join("\n");
    expect(output).not.toContain("secret@example.com");
    expect(output).not.toContain("@");
  });
});

describe("無効化と操作の記録", () => {
  it("無効にし_操作した管理者の sub・対象・操作・時刻を記録する_メールアドレスは入れない", async () => {
    const audit = createMemoryAuditLog();
    const { users, deps } = setup([user("user-9", "nine@example.com", null)], audit);
    const response = await handleDisableUser(disable({ username: "user-9" }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "disabled" });
    expect(users[0]?.enabled).toBe(false);
    expect(audit.entries).toEqual([
      { at: new Date(NOW).toISOString(), actor: ADMIN, target: "user-9", action: "disable-user" },
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain("@");
  });

  it("自分自身_無効にせず_記録もしない", async () => {
    const audit = createMemoryAuditLog();
    const { users, deps } = setup([user(ADMIN, "admin@example.com", null)], audit);
    const response = await handleDisableUser(disable({ username: ADMIN }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "self-disable" });
    expect(users[0]?.enabled).toBe(true);
    expect(audit.entries).toEqual([]);
  });

  it("いない利用者_404 で_記録しない", async () => {
    const audit = createMemoryAuditLog();
    const { deps } = setup([], audit);
    const response = await handleDisableUser(disable({ username: "user-0" }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(404);
    expect(audit.entries).toEqual([]);
  });

  it("操作した管理者を本文で申告する・ユーザー名の形でない_断り_無効にしない", async () => {
    const audit = createMemoryAuditLog();
    const { users, deps } = setup([user("user-9", "nine@example.com", null)], audit);
    const cookie = asUser(ADMIN);
    for (const key of ["actor", "sub", "admin", "PK", "SK"]) {
      const response = await handleDisableUser(disable({ username: "user-9", [key]: "admin-2" }, { cookie }), deps);
      expect(response.status, key).toBe(400);
    }
    for (const username of ["", "a#b", "ADMIN#x", "nine@example.com", "a/b", 1]) {
      expect((await handleDisableUser(disable({ username }, { cookie }), deps)).status, String(username)).toBe(400);
    }
    expect(users[0]?.enabled).toBe(true);
    expect(audit.entries).toEqual([]);
  });

  it("大きすぎる本文・JSON でない・別サイトから_断り_無効にしない", async () => {
    const { users, deps } = setup([user("user-9", "nine@example.com", null)]);
    const cookie = asUser(ADMIN);
    const large = await handleDisableUser(
      disable({ username: "user-9", pad: "x".repeat(MAX_ADMIN_BODY_BYTES) }, { cookie }),
      deps,
    );
    expect(large.status).toBe(413);
    const form = await handleDisableUser(
      new Request(`${ORIGIN}/api/admin/users/disable`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: "username=user-9",
      }),
      deps,
    );
    expect(form.status).toBe(415);
    const crossSite = await handleDisableUser(
      disable({ username: "user-9" }, { cookie, "sec-fetch-site": "cross-site" }),
      deps,
    );
    expect(crossSite.status).toBe(403);
    expect(users[0]?.enabled).toBe(true);
  });

  it("記録を残せない_503 を返す", async () => {
    const audit: AuditLog = {
      async record() {
        throw new Error("boom");
      },
    };
    const { deps } = setup([user("user-9", "nine@example.com", null)], audit);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleDisableUser(disable({ username: "user-9" }, { cookie: asUser(ADMIN) }), deps);
    const lines = log.mock.calls.map((call) => call.map(String).join(" "));
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    // 対象の利用者・操作した管理者は、記録に出さない
    expect(lines).toHaveLength(1);
    for (const value of ["user-9", "nine@example.com", ADMIN, "boom"]) expect(lines.join("\n")).not.toContain(value);
  });
});

describe("操作の記録の保存先(DynamoDB)", () => {
  it("PK=ADMIN、SK=AUDIT#{時刻}#{対象} に、操作した管理者・対象・操作を保存する", async () => {
    const table = fakeTable();
    const entry = { at: "2026-10-12T00:00:00.000Z", actor: ADMIN, target: "user-9", action: "disable-user" } as const;
    await createDynamoAuditLog({ tableName: "table-example", client: table.client }).record(entry);
    expect([...table.items.values()]).toEqual([
      { PK: "ADMIN", SK: "AUDIT#2026-10-12T00:00:00.000Z#user-9", type: "audit", ...entry },
    ]);
    expect(auditKey(entry)).toBe("AUDIT#2026-10-12T00:00:00.000Z#user-9");
  });
});
