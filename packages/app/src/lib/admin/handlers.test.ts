import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "@/lib/auth/types.ts";
import { type ManagedUser, type UserAdmin, UserAdminError } from "@/lib/auth/user-admin.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { fakeTable } from "@/lib/history/table-double.ts";
import { type AuditLog, auditKey, createDynamoAuditLog, createMemoryAuditLog } from "./audit.ts";
import {
  type AdminDeps,
  handleDisableUser,
  handleInviteUser,
  handleListUsers,
  handlePromoteUser,
  MAX_ADMIN_BODY_BYTES,
} from "./handlers.ts";

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
  /** 管理者のグループに加えたユーザー名 */
  const promoted: string[] = [];
  const admin: UserAdmin = {
    async listUsers() {
      return users.map((u) => ({ ...u }));
    },
    async inviteUser(email) {
      if (users.some((u) => u.email === email)) throw new UserAdminError("already-exists");
      const user = {
        username: `user-${users.length + 1}`,
        email,
        status: "FORCE_CHANGE_PASSWORD",
        enabled: true,
        createdAt: null,
      };
      users.push(user);
      return { ...user };
    },
    async disableUser(username) {
      const user = users.find((u) => u.username === username);
      if (!user) throw new UserAdminError("not-found");
      user.enabled = false;
    },
    async promoteUser(username) {
      if (!users.some((u) => u.username === username)) throw new UserAdminError("not-found");
      if (!promoted.includes(username)) promoted.push(username);
    },
  };
  return { users, admin, promoted };
}

const user = (username: string, email: string, createdAt: string | null): ManagedUser => ({
  username,
  email,
  status: "CONFIRMED",
  enabled: true,
  createdAt,
});

function setup(initial: ManagedUser[] = [], audit: AuditLog = createMemoryAuditLog()) {
  const { users, admin, promoted } = memoryUsers(initial);
  const deps: AdminDeps = {
    auth: { verifier, provider: noRefresh, secure: false },
    users: admin,
    audit,
    now: () => NOW,
  };
  return { users, deps, audit, promoted };
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
const invite = (value: unknown, headers: Record<string, string> = {}) => post("/api/admin/users", value, headers);
const disable = (value: unknown, headers: Record<string, string> = {}) =>
  post("/api/admin/users/disable", value, headers);
const promote = (value: unknown, headers: Record<string, string> = {}) =>
  post("/api/admin/users/promote", value, headers);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("管理者の API の認可", () => {
  it("未ログイン・壊れたトークン・管理者でない利用者_どの操作も 403 で断り_何も変えない", async () => {
    const { users, deps, promoted } = setup([user("user-9", "nine@example.com", null)]);
    for (const cookie of [undefined, "mokumoku_id=forged", asUser("learner")]) {
      const headers: Record<string, string> = cookie ? { cookie } : {};
      expect((await handleListUsers(get("", headers), deps)).status).toBe(403);
      expect((await handleInviteUser(invite({ email: "new@example.com" }, headers), deps)).status).toBe(403);
      expect((await handleDisableUser(disable({ username: "user-9" }, headers), deps)).status).toBe(403);
      expect((await handlePromoteUser(promote({ username: "user-9" }, headers), deps)).status).toBe(403);
    }
    expect(promoted).toEqual([]);
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
    const response = await handleListUsers(get("", { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});

describe("招待", () => {
  it("メールアドレスで招待し_結果を返す_同じアドレスは 409", async () => {
    const { users, deps } = setup();
    const response = await handleInviteUser(invite({ email: " new@example.com " }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { user: ManagedUser }).user).toMatchObject({
      email: "new@example.com",
      status: "FORCE_CHANGE_PASSWORD",
    });
    expect(users).toHaveLength(1);
    const again = await handleInviteUser(invite({ email: "new@example.com" }, { cookie: asUser(ADMIN) }), deps);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already-exists" });
  });

  it("メールアドレスの形でない・未知の項目・大きすぎる本文・JSON でない・別サイトから_断り_招待しない", async () => {
    const { users, deps } = setup();
    const cookie = asUser(ADMIN);
    for (const email of ["", "not-an-email", "a@", `${"a".repeat(250)}@example.com`, 1]) {
      expect((await handleInviteUser(invite({ email }, { cookie }), deps)).status, String(email)).toBe(400);
    }
    for (const key of ["sub", "actor", "groups", "username"]) {
      const response = await handleInviteUser(invite({ email: "new@example.com", [key]: "x" }, { cookie }), deps);
      expect(response.status, key).toBe(400);
    }
    const large = await handleInviteUser(
      invite({ email: "new@example.com", pad: "x".repeat(MAX_ADMIN_BODY_BYTES) }, { cookie }),
      deps,
    );
    expect(large.status).toBe(413);
    const broken = await handleInviteUser(post("/api/admin/users", null, { cookie }, "{"), deps);
    expect(broken.status).toBe(400);
    const form = await handleInviteUser(
      new Request(`${ORIGIN}/api/admin/users`, {
        method: "POST",
        headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
        body: "email=new%40example.com",
      }),
      deps,
    );
    expect(form.status).toBe(415);
    const crossSite = await handleInviteUser(
      invite({ email: "new@example.com" }, { cookie, "sec-fetch-site": "cross-site" }),
      deps,
    );
    expect(crossSite.status).toBe(403);
    expect(users).toHaveLength(0);
  });

  it("メールアドレス_成功しても失敗しても_サーバーのログに出さない", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const { deps } = setup();
    const cookie = asUser(ADMIN);
    await handleInviteUser(invite({ email: "secret@example.com" }, { cookie }), deps);
    await handleInviteUser(invite({ email: "secret@example.com" }, { cookie }), deps);
    deps.users.inviteUser = async () => {
      throw new Error("secret@example.com");
    };
    await handleInviteUser(invite({ email: "secret@example.com" }, { cookie }), deps);
    await handleListUsers(get("", { cookie }), deps);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
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

  it("記録を残せない_503 を返す", async () => {
    const audit: AuditLog = {
      async record() {
        throw new Error("boom");
      },
    };
    const { deps } = setup([user("user-9", "nine@example.com", null)], audit);
    const response = await handleDisableUser(disable({ username: "user-9" }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});

describe("管理者への昇格と操作の記録", () => {
  it("昇格し_操作した管理者の sub・対象・操作・時刻を記録する_メールアドレスは入れない", async () => {
    const audit = createMemoryAuditLog();
    const { deps, promoted } = setup([user("user-9", "nine@example.com", null)], audit);
    const response = await handlePromoteUser(promote({ username: "user-9" }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "promoted" });
    expect(promoted).toEqual(["user-9"]);
    expect(audit.entries).toEqual([
      { at: new Date(NOW).toISOString(), actor: ADMIN, target: "user-9", action: "promote-user" },
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain("@");
  });

  it("管理者でない利用者_昇格を実行できず_記録もしない", async () => {
    const audit = createMemoryAuditLog();
    const { deps, promoted } = setup([user("learner", "learner@example.com", null)], audit);
    // 自分自身を昇格させようとしても、管理者でなければ 403
    const response = await handlePromoteUser(promote({ username: "learner" }, { cookie: asUser("learner") }), deps);
    expect(response.status).toBe(403);
    expect(promoted).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("別サイトからの送信_断り_昇格しない", async () => {
    const { deps, promoted } = setup([user("user-9", "nine@example.com", null)]);
    const response = await handlePromoteUser(
      promote({ username: "user-9" }, { cookie: asUser(ADMIN), "sec-fetch-site": "cross-site" }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(promoted).toEqual([]);
  });

  it("いない利用者_404 で_記録しない", async () => {
    const audit = createMemoryAuditLog();
    const { deps } = setup([], audit);
    const response = await handlePromoteUser(promote({ username: "user-0" }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(404);
    expect(audit.entries).toEqual([]);
  });

  it("操作した管理者を本文で申告する・ユーザー名の形でない・本文が大きすぎる_断り_昇格しない", async () => {
    const audit = createMemoryAuditLog();
    const { deps, promoted } = setup([user("user-9", "nine@example.com", null)], audit);
    const cookie = asUser(ADMIN);
    for (const key of ["actor", "sub", "admin", "group", "PK", "SK"]) {
      const response = await handlePromoteUser(promote({ username: "user-9", [key]: "admin-2" }, { cookie }), deps);
      expect(response.status, key).toBe(400);
    }
    for (const username of ["", "a#b", "ADMIN#x", "nine@example.com", "a/b", 1]) {
      expect((await handlePromoteUser(promote({ username }, { cookie }), deps)).status, String(username)).toBe(400);
    }
    const big = post(
      "/api/admin/users/promote",
      null,
      { cookie },
      JSON.stringify({ username: "a".repeat(MAX_ADMIN_BODY_BYTES) }),
    );
    expect((await handlePromoteUser(big, deps)).status).toBe(413);
    expect(promoted).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  it("すでに管理者のユーザーを昇格する_変わらず成功し_記録は残す", async () => {
    const audit = createMemoryAuditLog();
    const { deps, promoted } = setup([user("user-9", "nine@example.com", null)], audit);
    const cookie = asUser(ADMIN);
    expect((await handlePromoteUser(promote({ username: "user-9" }, { cookie }), deps)).status).toBe(200);
    expect((await handlePromoteUser(promote({ username: "user-9" }, { cookie }), deps)).status).toBe(200);
    expect(promoted).toEqual(["user-9"]);
    expect(audit.entries).toHaveLength(2);
  });

  it("記録を残せない_503 を返す", async () => {
    const audit: AuditLog = {
      async record() {
        throw new Error("boom");
      },
    };
    const { deps } = setup([user("user-9", "nine@example.com", null)], audit);
    const response = await handlePromoteUser(promote({ username: "user-9" }, { cookie: asUser(ADMIN) }), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("無効化は_昇格の追加後も変わらず動き_自分自身は無効にできない", async () => {
    const audit = createMemoryAuditLog();
    const { users, deps } = setup(
      [user(ADMIN, "admin@example.com", null), user("user-9", "nine@example.com", null)],
      audit,
    );
    const cookie = asUser(ADMIN);
    expect((await handleDisableUser(disable({ username: "user-9" }, { cookie }), deps)).status).toBe(200);
    expect((await handleDisableUser(disable({ username: ADMIN }, { cookie }), deps)).status).toBe(400);
    expect(users.find((u) => u.username === "user-9")?.enabled).toBe(false);
    expect(audit.entries.map((e) => e.action)).toEqual(["disable-user"]);
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

  it("昇格の記録_操作の種類を持つ", async () => {
    const table = fakeTable();
    const entry = { at: "2026-10-12T00:00:00.000Z", actor: ADMIN, target: "user-9", action: "promote-user" } as const;
    await createDynamoAuditLog({ tableName: "table-example", client: table.client }).record(entry);
    expect([...table.items.values()][0]).toMatchObject({ type: "audit", action: "promote-user", actor: ADMIN });
  });
});
