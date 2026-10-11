import { describe, expect, it } from "vitest";
import { createFakeProvider, createFakeVerifier, FAKE_USER_EMAIL, FAKE_USER_PHRASE, fakeSub } from "./fake.ts";
import { authenticate, isPublicPath } from "./guard.ts";
import { readCookies, withTokenCookies } from "./session.ts";
import type { AuthProvider, Tokens } from "./types.ts";

async function signedIn(now: () => number, provider: AuthProvider = createFakeProvider(now)) {
  const result = await provider.signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
  if (result.kind !== "signed-in") throw new Error("unexpected");
  return { provider, tokens: result.tokens };
}

const cookieOf = (tokens: Tokens) => withTokenCookies(null, tokens);

describe("authenticate", () => {
  it("有効な ID トークンの Cookie_利用者の sub を返し_Cookie は更新しない", async () => {
    const now = () => Date.now();
    const { provider, tokens } = await signedIn(now);
    const auth = await authenticate(cookieOf(tokens), { verifier: createFakeVerifier(now), provider, secure: true });
    expect(auth?.user.sub).toBe(fakeSub(FAKE_USER_EMAIL));
    expect(auth?.setCookies).toEqual([]);
  });

  it("Cookie がない_null を返す", async () => {
    const now = () => Date.now();
    const provider = createFakeProvider(now);
    expect(await authenticate(null, { verifier: createFakeVerifier(now), provider, secure: true })).toBeNull();
  });

  it("ID トークンが壊れていてリフレッシュトークンもない_null を返す", async () => {
    const now = () => Date.now();
    const provider = createFakeProvider(now);
    const header = "mokumoku_id=broken; other=1";
    expect(await authenticate(header, { verifier: createFakeVerifier(now), provider, secure: true })).toBeNull();
  });

  it("ID トークンの期限が切れて消えている_リフレッシュトークンで更新して通す", async () => {
    let time = Date.now();
    const now = () => time;
    const { provider, tokens } = await signedIn(now);
    time += 2 * 3600 * 1000;
    // 期限切れの ID トークンは Cookie ごと消える。リフレッシュトークンだけが残る
    const header = `other=1; mokumoku_refresh=${encodeURIComponent(tokens.refreshToken ?? "")}`;
    const auth = await authenticate(header, { verifier: createFakeVerifier(now), provider, secure: true });
    expect(auth?.user.sub).toBe(fakeSub(FAKE_USER_EMAIL));
    expect(auth?.setCookies.some((c) => c.startsWith("mokumoku_id="))).toBe(true);
    // 後続の処理に渡す Cookie は、新しいトークンに差し替わり、ほかの Cookie は残る
    expect(auth?.cookieHeader).toContain("other=1");
    expect(readCookies(auth?.cookieHeader ?? null).id).toBeTruthy();
  });

  it("リフレッシュトークンが無効_null を返す", async () => {
    const now = () => Date.now();
    const provider = createFakeProvider(now);
    const auth = await authenticate("mokumoku_refresh=unknown", {
      verifier: createFakeVerifier(now),
      provider,
      secure: true,
    });
    expect(auth).toBeNull();
  });

  it("更新で得たトークンを検証で拒否された_null を返す", async () => {
    const now = () => Date.now();
    const { provider, tokens } = await signedIn(now);
    const rejectAll = { verifyIdToken: async () => null };
    const header = `mokumoku_refresh=${encodeURIComponent(tokens.refreshToken ?? "")}`;
    expect(await authenticate(header, { verifier: rejectAll, provider, secure: true })).toBeNull();
  });
});

describe("isPublicPath", () => {
  it.each([
    "/login",
    "/forgot-password",
    "/api/auth/login",
    "/api/auth/new-password",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/session",
    "/_next/static/chunks/a.js",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sitemap.xml",
    "/sw.js",
    "/icons/icon-192.png",
  ])("ログインなしで開ける_%s", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    "/",
    "/exams",
    "/exams/SAMPLE/play",
    "/help",
    "/account",
    "/api/history/results",
    "/api/auth/change-password",
    "/api/auth/unknown",
    "/api/auth/",
    "/api/auth",
    "/loginx",
    "/api/authx",
    "/release-notes",
    "/api/push/subscription",
    "/api/push/test",
    "/icons/unknown.png",
  ])("ログインが必要_%s", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  it.each([
    ["大文字小文字を変える", "/API/AUTH/LOGIN"],
    ["大文字小文字を一部変える", "/api/auth/Login"],
    ["末尾にスラッシュを付ける", "/api/auth/login/"],
    ["公開の画面の末尾にスラッシュを付ける", "/login/"],
    ["公開の接頭辞から親をたどる", "/_next/../exams"],
    ["公開の API から親をたどる", "/api/auth/login/../change-password"],
    ["公開の接頭辞から API へ抜ける", "/_next/static/../../api/history/results"],
    ["エンコードしたドット", "/_next/%2e%2e/exams"],
    ["エンコードしたスラッシュ", "/api/auth%2Flogin"],
    ["バックスラッシュ", "/_next\\..\\exams"],
    ["接頭辞だけ似ている", "/_nextx/a"],
    ["公開の API に拡張子を付ける", "/api/auth/login.json"],
    ["公開の API の後ろに続ける", "/api/auth/login/extra"],
    ["公開のファイルの末尾にスラッシュを付ける", "/sw.js/"],
    ["公開のファイルから親をたどる", "/icons/../api/push/test"],
  ])("公開を広げられない_%s", (_name, path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe("withTokenCookies", () => {
  it("トークンの Cookie だけ差し替え_ほかの Cookie は残す", () => {
    const header = withTokenCookies("a=1; mokumoku_id=old; b=2", { idToken: "i", accessToken: "x", expiresIn: 60 });
    expect(header).toContain("a=1");
    expect(header).toContain("b=2");
    expect(header).not.toContain("old");
    expect(readCookies(header)).toMatchObject({ id: "i", access: "x" });
  });

  it("リフレッシュトークンが返らない_既存のものを残す", () => {
    const header = withTokenCookies("mokumoku_refresh=r", { idToken: "i", accessToken: "x", expiresIn: 60 });
    expect(readCookies(header).refresh).toBe("r");
  });
});

describe("代替の検証", () => {
  it("期限切れの代替トークン_拒否する", async () => {
    let time = Date.now();
    const now = () => time;
    const { tokens } = await signedIn(now);
    time += 2 * 3600 * 1000;
    expect(await createFakeVerifier(now).verifyIdToken(tokens.idToken)).toBeNull();
  });

  it("アクセストークンを ID トークンとして出された_拒否する", async () => {
    const now = () => Date.now();
    const { tokens } = await signedIn(now);
    expect(await createFakeVerifier(now).verifyIdToken(tokens.accessToken)).toBeNull();
  });
});
