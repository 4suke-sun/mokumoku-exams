import { describe, expect, it } from "vitest";
import {
  createFakeProvider,
  FAKE_INVITED_EMAIL,
  FAKE_INVITED_PHRASE,
  FAKE_RESET_CODE,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
} from "./fake.ts";
import {
  type Deps,
  handleChangePassword,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleNewPassword,
  handleRefresh,
  handleResetPassword,
  handleSession,
} from "./handlers.ts";
import { AuthError, type AuthProvider } from "./types.ts";

// 規則に合うテスト用の値。実行時に組み立てる
const phrase = (name: string) => ["Example", name, "Phrase-9"].join("-");
const FRESH = phrase("Fresh");
const RESET = phrase("Reset");
const CHANGED = phrase("Changed");

function deps(provider: AuthProvider = createFakeProvider(), now = Date.now()): Deps {
  return { provider, secure: true, now: () => now };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Set-Cookie をまとめて Cookie ヘッダーにする(破棄されたものは除く) */
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((c) => !c.includes("Max-Age=0"))
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function login(d: Deps, password = FAKE_USER_PHRASE) {
  return handleLogin(post({ email: FAKE_USER_EMAIL, password }), d);
}

describe("ログイン", () => {
  it("正しい認証情報のとき_3 つの Cookie が設定され_本文にトークンを含めない", async () => {
    const response = await login(deps());
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(3);
    expect(await response.text()).not.toContain("eyJ");
  });

  it("誤ったパスワードのとき_401 で Cookie を設定しない", async () => {
    const response = await login(deps(), "wrong");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid-credentials" });
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("未知の項目を含む入力のとき_400", async () => {
    const response = await handleLogin(post({ email: "a@example.com", password: "p", extra: 1 }), deps());
    expect(response.status).toBe(400);
  });

  it("JSON でないとき_415", async () => {
    const request = new Request("https://example.com/api", { method: "POST", body: "a=b" });
    expect((await handleLogin(request, deps())).status).toBe(415);
  });

  it("別サイトからの送信とブラウザが示したとき_403", async () => {
    const response = await handleLogin(
      post({ email: "a@example.com", password: "p" }, { "sec-fetch-site": "cross-site" }),
      deps(),
    );
    expect(response.status).toBe(403);
  });

  it("想定外の失敗のとき_503 で詳細を返さない", async () => {
    const provider = {
      signIn: async () => {
        throw new Error("MARKER detail");
      },
    } as unknown as AuthProvider;
    const response = await login(deps(provider));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("MARKER");
  });
});

describe("初回のパスワード設定", () => {
  it("招待されたユーザーは_新しいパスワードを決めるとログインできる", async () => {
    const d = deps();
    const first = await handleLogin(post({ email: FAKE_INVITED_EMAIL, password: FAKE_INVITED_PHRASE }), d);
    const challenge = await first.json();
    expect(challenge.status).toBe("new-password-required");
    expect(first.headers.getSetCookie()).toHaveLength(0);

    const done = await handleNewPassword(
      post({ username: challenge.username, session: challenge.session, newPassword: FRESH }),
      d,
    );
    expect(done.status).toBe(200);
    expect(done.headers.getSetCookie()).toHaveLength(3);
  });

  it("規則に合わないパスワードのとき_400", async () => {
    const d = deps();
    const challenge = await (
      await handleLogin(post({ email: FAKE_INVITED_EMAIL, password: FAKE_INVITED_PHRASE }), d)
    ).json();
    const response = await handleNewPassword(
      post({ username: challenge.username, session: challenge.session, newPassword: "short" }),
      d,
    );
    expect(response.status).toBe(400);
  });
});

describe("パスワードの再設定", () => {
  it("登録のないメールアドレスでも_送ったと同じ応答になる", async () => {
    const response = await handleForgotPassword(post({ email: "nobody@example.com" }), deps());
    expect(await response.json()).toEqual({ status: "sent" });
  });

  it("正しいコードと規則に合うパスワードで_再設定でき_新しいパスワードでログインできる", async () => {
    const d = deps();
    const reset = await handleResetPassword(
      post({ email: FAKE_USER_EMAIL, code: FAKE_RESET_CODE, newPassword: RESET }),
      d,
    );
    expect(reset.status).toBe(200);
    expect((await login(d, RESET)).status).toBe(200);
    expect((await login(d)).status).toBe(401);
  });

  it("コードが違うとき_400", async () => {
    const response = await handleResetPassword(
      post({ email: FAKE_USER_EMAIL, code: "000000", newPassword: RESET }),
      deps(),
    );
    expect(await response.json()).toEqual({ error: "code-invalid" });
  });
});

describe("ログアウトとセッション", () => {
  it("ログアウトすると_Cookie が破棄され_リフレッシュトークンが無効になる", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const out = await handleLogout(post({}, { cookie }), d);
    expect(out.headers.getSetCookie()).toHaveLength(3);
    expect(out.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);
    // 無効にしたリフレッシュトークンでは、更新できない
    const again = await handleRefresh(post({}, { cookie }), d);
    expect(again.status).toBe(401);
  });

  it("サーバー側の無効化に失敗しても_Cookie は破棄する", async () => {
    const provider = {
      signOut: async () => {
        throw new AuthError("unavailable");
      },
    } as unknown as AuthProvider;
    const response = await handleLogout(post({}, { cookie: "mokumoku_refresh=r" }), deps(provider));
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });

  it("ログイン中の状態を返す", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const body = await (await handleSession(new Request("https://example.com/api", { headers: { cookie } }), d)).json();
    expect(body).toMatchObject({ signedIn: true, email: FAKE_USER_EMAIL });
  });

  it("Cookie がないとき_ログインしていないと返し_Cookie には触れない", async () => {
    const response = await handleSession(new Request("https://example.com/api"), deps());
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("ID トークンが期限切れでも_更新できればログイン中として返し_新しい Cookie を設定する", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const later = deps(d.provider, Date.now() + 2 * 3600 * 1000);
    const response = await handleSession(new Request("https://example.com/api", { headers: { cookie } }), later);
    expect((await response.json()).signedIn).toBe(true);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("更新できないとき_ログインしていないと返し_Cookie を破棄する", async () => {
    const response = await handleSession(
      new Request("https://example.com/api", { headers: { cookie: "mokumoku_refresh=revoked" } }),
      deps(),
    );
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  it("更新に成功すると_新しい期限と Cookie を返す", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const response = await handleRefresh(post({}, { cookie }), d);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("リフレッシュトークンがないとき_更新は 401 で Cookie を破棄する", async () => {
    const response = await handleRefresh(post({}), deps());
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });
});

describe("パスワードの変更", () => {
  it("ログイン中は変更でき_新しいパスワードで再ログインできる", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const changed = await handleChangePassword(
      post({ previousPassword: FAKE_USER_PHRASE, proposedPassword: CHANGED }, { cookie }),
      d,
    );
    expect(changed.status).toBe(200);
    expect((await login(d, CHANGED)).status).toBe(200);
    expect((await login(d)).status).toBe(401);
  });

  it("いまのパスワードが違うとき_401", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const response = await handleChangePassword(
      post({ previousPassword: "wrong", proposedPassword: CHANGED }, { cookie }),
      d,
    );
    expect(response.status).toBe(401);
  });

  it("ログインしていないとき_401 で変更しない", async () => {
    const response = await handleChangePassword(
      post({ previousPassword: FAKE_USER_PHRASE, proposedPassword: CHANGED }),
      deps(),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "session-expired" });
  });
});
