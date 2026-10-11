import { describe, expect, it } from "vitest";
import { ADMIN_GROUP, authenticateAdmin, isAdmin, isAdminPath } from "./admin.ts";
import {
  createFakeProvider,
  createFakeVerifier,
  FAKE_ADMIN_EMAIL,
  FAKE_ADMIN_PHRASE,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
} from "./fake.ts";
import type { GuardDeps } from "./guard.ts";
import { withTokenCookies } from "./session.ts";

describe("管理者のグループ", () => {
  it("グループ名_インフラの UserPool のグループと同じ値に固定する", () => {
    expect(ADMIN_GROUP).toBe("admins");
  });

  it("検証した利用者のグループに管理者のグループがあるときだけ_管理者", () => {
    expect(isAdmin({ sub: "a", groups: ["admins"] })).toBe(true);
    expect(isAdmin({ sub: "a", groups: ["other", "admins"] })).toBe(true);
    expect(isAdmin({ sub: "a", groups: [] })).toBe(false);
    expect(isAdmin({ sub: "a", groups: ["Admins", "admin", "admins "] })).toBe(false);
  });
});

describe("isAdminPath", () => {
  it.each(["/admin", "/admin/", "/admin/users", "/api/admin", "/api/admin/users"])("管理者の経路_%s", (path) => {
    expect(isAdminPath(path)).toBe(true);
  });

  it.each([
    "/Admin",
    "/ADMIN/users",
    "/%61dmin",
    "/admin%2Fusers",
    "//admin",
    "/api//admin/x",
    "/\\admin",
    "/%E0%A4%A",
  ])("符号化・大文字小文字・重なったスラッシュ・壊れた符号化でも_管理者の経路として扱う_%s", (path) => {
    expect(isAdminPath(path)).toBe(true);
  });

  it.each(["/", "/exams", "/administrator", "/admins", "/api/history/results", "/help/admin"])(
    "管理者の経路でない_%s",
    (path) => {
      expect(isAdminPath(path)).toBe(false);
    },
  );
});

describe("authenticateAdmin", () => {
  const provider = createFakeProvider();
  const deps: GuardDeps = { verifier: createFakeVerifier(), provider, secure: false };
  const cookieOf = async (email: string, phrase: string) => {
    const signedIn = await provider.signIn(email, phrase);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    return withTokenCookies(null, signedIn.tokens);
  };

  it("管理者_利用者を返す", async () => {
    const auth = await authenticateAdmin(await cookieOf(FAKE_ADMIN_EMAIL, FAKE_ADMIN_PHRASE), deps);
    expect(auth?.user.groups).toEqual(["admins"]);
  });

  it("管理者でない・未ログイン・壊れたトークン_null", async () => {
    expect(await authenticateAdmin(await cookieOf(FAKE_USER_EMAIL, FAKE_USER_PHRASE), deps)).toBeNull();
    expect(await authenticateAdmin(null, deps)).toBeNull();
    expect(await authenticateAdmin("mokumoku_id=forged", deps)).toBeNull();
  });
});
