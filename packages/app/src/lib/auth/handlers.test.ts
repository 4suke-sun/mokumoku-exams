import { describe, expect, it, vi } from "vitest";
import { ownerTag } from "../owner-tag.ts";
import {
  createFakeDirectory,
  createFakeProvider,
  createFakeUserAdmin,
  createFakeVerifier,
  FAKE_ADMIN_EMAIL,
  FAKE_ADMIN_PHRASE,
  FAKE_INVITED_EMAIL,
  FAKE_INVITED_PHRASE,
  FAKE_RESET_CODE,
  FAKE_SEND_LIMIT_EMAIL,
  FAKE_SIGNUP_CODE,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
  fakeSub,
} from "./fake.ts";
import {
  type DeleteAccountDeps,
  type Deps,
  handleChangePassword,
  handleConfirmSignUp,
  handleDeleteAccount,
  handleForgotPassword,
  handleLogin,
  handleLogout,
  handleNewPassword,
  handleRefresh,
  handleResendCode,
  handleResetPassword,
  handleSession,
  handleSignUp,
  type SignUpDeps,
} from "./handlers.ts";
import { AuthError, type AuthProvider } from "./types.ts";
import { UNCONFIRMED_REPLACE_AFTER_MS } from "./user-admin.ts";

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
    expect(body).toMatchObject({ signedIn: true, email: FAKE_USER_EMAIL, isAdmin: false });
  });

  it("ログイン中_持ち主の印を返し_利用者の識別子は含まない", async () => {
    const d = deps();
    const cookie = cookieHeader(await login(d));
    const response = await handleSession(new Request("https://example.com/api", { headers: { cookie } }), d);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.owner).toBe(ownerTag(fakeSub(FAKE_USER_EMAIL)));
    expect(body.owner).toMatch(/^[0-9a-f]{16}$/);
    expect(text).not.toContain(fakeSub(FAKE_USER_EMAIL));
    expect(body).not.toHaveProperty("sub");
  });

  it("別のアカウント_別の持ち主の印を返す", async () => {
    const d = deps();
    const sessionOf = async (email: string, password: string) => {
      const cookie = cookieHeader(await handleLogin(post({ email, password }), d));
      return (await handleSession(new Request("https://example.com/api", { headers: { cookie } }), d)).json();
    };
    const user = await sessionOf(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    const admin = await sessionOf(FAKE_ADMIN_EMAIL, FAKE_ADMIN_PHRASE);
    expect(user.owner).not.toBe(admin.owner);
  });

  it("管理者のグループに入っている_表示のための isAdmin を true で返す", async () => {
    const d = deps();
    const cookie = cookieHeader(await handleLogin(post({ email: FAKE_ADMIN_EMAIL, password: FAKE_ADMIN_PHRASE }), d));
    const body = await (await handleSession(new Request("https://example.com/api", { headers: { cookie } }), d)).json();
    expect(body).toMatchObject({ signedIn: true, email: FAKE_ADMIN_EMAIL, isAdmin: true });
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

const NEW_EMAIL = "new@example.com";
const OTHER = phrase("Other");

/** 登録の API の依存。代替の認証と代替の利用者の管理が、同じ一覧を共有する。`clock.now` を進めて時間をたたせる */
function signUpDeps(start = Date.parse("2026-01-01T00:00:00.000Z")) {
  const clock = { now: start };
  const now = () => clock.now;
  const directory = createFakeDirectory(now);
  const provider = createFakeProvider(now, directory);
  const users = createFakeUserAdmin(directory);
  const d: SignUpDeps = { provider, secure: true, now, users };
  return { d, clock, provider, users };
}

const signUp = (d: SignUpDeps, email: string, password: string) => handleSignUp(post({ email, password }), d);

describe("新規登録", () => {
  it("新しいメールアドレス_確認コードを送ったと返し_確認待ちになり_Cookie は付けない", async () => {
    const { d, users } = signUpDeps();
    const response = await signUp(d, NEW_EMAIL, FRESH);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "code-sent" });
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(await users.getSignUpState(NEW_EMAIL)).toMatchObject({ status: "UNCONFIRMED" });
  });

  it("規則に合わないパスワード_400", async () => {
    const { d } = signUpDeps();
    const response = await signUp(d, NEW_EMAIL, "short");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "password-policy" });
  });

  it("送信の上限に当たる_429 で送信の上限の種類を返す", async () => {
    const { d } = signUpDeps();
    const response = await signUp(d, FAKE_SEND_LIMIT_EMAIL, FRESH);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "send-limit" });
  });

  it("確認済みのメールアドレス_パスワードを試さずに登録できないと返す", async () => {
    const { d, provider } = signUpDeps();
    const signIn = vi.spyOn(provider, "signIn");
    const response = await signUp(d, FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already-exists" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("確認待ちで同じパスワードの登録し直し_確認コードを送り直して登録と同じ応答にし_Cookie は付けない", async () => {
    const { d, provider } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    const resend = vi.spyOn(provider, "resendCode");
    const response = await signUp(d, NEW_EMAIL, FRESH);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "code-sent" });
    expect(response.headers.getSetCookie()).toHaveLength(0);
    expect(resend).toHaveBeenCalledWith(NEW_EMAIL);
  });

  it("確認待ちで違うパスワード_24 時間たつ前は登録できず_たったあとは置き換えて登録し直せる", async () => {
    const { d, clock, users } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    clock.now += UNCONFIRMED_REPLACE_AFTER_MS - 1;
    const early = await signUp(d, NEW_EMAIL, OTHER);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "already-exists" });
    clock.now += 1;
    const replaced = await signUp(d, NEW_EMAIL, OTHER);
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toEqual({ status: "code-sent" });
    // 置き換えたアカウントは、新しいパスワードで確認待ちになる(作成日時も新しくなる)
    expect(await users.getSignUpState(NEW_EMAIL)).toEqual({
      status: "UNCONFIRMED",
      createdAt: new Date(clock.now).toISOString(),
    });
    const confirmed = await handleConfirmSignUp(post({ email: NEW_EMAIL, code: FAKE_SIGNUP_CODE, password: OTHER }), d);
    expect(await confirmed.json()).toEqual({ status: "signed-in" });
  });

  it("確認済みのアカウント_24 時間たっていても削除を呼ばない", async () => {
    const { d, clock, users } = signUpDeps();
    const remove = vi.spyOn(users, "deleteStaleUnconfirmed");
    clock.now += UNCONFIRMED_REPLACE_AFTER_MS * 10;
    expect((await signUp(d, FAKE_USER_EMAIL, OTHER)).status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
    expect(await users.getSignUpState(FAKE_USER_EMAIL)).toMatchObject({ status: "CONFIRMED" });
  });

  it("確認待ちの判定のあとに確認済みになっていた_利用者の管理が状態を読み直して消さない", async () => {
    const { d, clock, provider } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    clock.now += UNCONFIRMED_REPLACE_AFTER_MS;
    // 登録の API がパスワードを試す前に、本人が確認を済ませる
    const original = provider.signIn.bind(provider);
    vi.spyOn(provider, "signIn").mockImplementation(async (email, password) => {
      await provider.confirmSignUp({ email, code: FAKE_SIGNUP_CODE });
      return original(email, password);
    });
    const response = await signUp(d, NEW_EMAIL, OTHER);
    expect(response.status).toBe(409);
    vi.mocked(provider.signIn).mockRestore();
    expect((await handleLogin(post({ email: NEW_EMAIL, password: FRESH }), d)).status).toBe(200);
  });

  it("状態を読めない_503 にして登録し直さない", async () => {
    const { d } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    const users: SignUpDeps["users"] = {
      getSignUpState: async () => {
        throw new Error("MARKER");
      },
      deleteStaleUnconfirmed: vi.fn(),
    };
    const response = await signUp({ ...d, users }, NEW_EMAIL, FRESH);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("MARKER");
    expect(users.deleteStaleUnconfirmed).not.toHaveBeenCalled();
  });
});

describe("登録の確認", () => {
  it("正しいコード_確認が通り_ログインして Cookie を付ける", async () => {
    const { d } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    const response = await handleConfirmSignUp(post({ email: NEW_EMAIL, code: FAKE_SIGNUP_CODE, password: FRESH }), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "signed-in" });
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });

  it("コードが違う_400 で確認しない", async () => {
    const { d, users } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    const response = await handleConfirmSignUp(post({ email: NEW_EMAIL, code: "000000", password: FRESH }), d);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "code-invalid" });
    expect(await users.getSignUpState(NEW_EMAIL)).toMatchObject({ status: "UNCONFIRMED" });
  });

  it("確認は通ったがパスワードが違う_Cookie を付けずに確認済みと返す", async () => {
    const { d } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    const response = await handleConfirmSignUp(post({ email: NEW_EMAIL, code: FAKE_SIGNUP_CODE, password: OTHER }), d);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "confirmed" });
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  it("確認がまだのアカウントでログインする_403 で確認がまだの種類を返す", async () => {
    const { d } = signUpDeps();
    await signUp(d, NEW_EMAIL, FRESH);
    const response = await handleLogin(post({ email: NEW_EMAIL, password: FRESH }), d);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not-confirmed" });
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });
});

describe("確認コードの送り直し", () => {
  it("登録のないメールアドレスでも_送ったと同じ応答になる", async () => {
    const response = await handleResendCode(post({ email: "nobody@example.com" }), deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "sent" });
  });

  it("送信の上限に当たる_429 で送信の上限の種類を返す", async () => {
    const response = await handleResendCode(post({ email: FAKE_SEND_LIMIT_EMAIL }), deps());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "send-limit" });
  });

  it("パスワードの再設定で送信の上限に当たる_429 で送信の上限の種類を返す", async () => {
    const response = await handleForgotPassword(post({ email: FAKE_SEND_LIMIT_EMAIL }), deps());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "send-limit" });
  });
});

describe("退会", () => {
  function deleteDeps(provider: AuthProvider = createFakeProvider()) {
    const purged: string[] = [];
    const d: DeleteAccountDeps = {
      ...deps(provider),
      verifier: createFakeVerifier(),
      purge: async (sub) => {
        purged.push(sub);
      },
    };
    return { d, purged };
  }
  const remove = (d: DeleteAccountDeps, password: string, cookie?: string) =>
    handleDeleteAccount(post({ password }, cookie ? { cookie } : {}), d);

  it("正しいパスワード_データを消してからアカウントを消し_Cookie を破棄する", async () => {
    const provider = createFakeProvider();
    const { d, purged } = deleteDeps(provider);
    const order: string[] = [];
    const purge = d.purge;
    d.purge = async (sub) => {
      order.push("purge");
      await purge(sub);
    };
    const original = provider.deleteAccount.bind(provider);
    vi.spyOn(provider, "deleteAccount").mockImplementation(async (token) => {
      order.push("delete");
      await original(token);
    });
    const cookie = cookieHeader(await login(d));
    const response = await remove(d, FAKE_USER_PHRASE, cookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "deleted" });
    expect(response.headers.getSetCookie().every((c) => c.includes("Max-Age=0"))).toBe(true);
    expect(purged).toEqual([fakeSub(FAKE_USER_EMAIL)]);
    expect(order).toEqual(["purge", "delete"]);
    expect((await login(d)).status).toBe(401);
  });

  it("パスワードが違う_401 で何も消さない", async () => {
    const provider = createFakeProvider();
    const { d, purged } = deleteDeps(provider);
    const deleteAccount = vi.spyOn(provider, "deleteAccount");
    const cookie = cookieHeader(await login(d));
    const response = await remove(d, "wrong", cookie);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid-credentials" });
    expect(purged).toEqual([]);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect((await login(d)).status).toBe(200);
  });

  it("ログインしていない_401 で何も消さない", async () => {
    const { d, purged } = deleteDeps();
    const response = await remove(d, FAKE_USER_PHRASE);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "session-expired" });
    expect(purged).toEqual([]);
  });

  it("データを消せない_503 でアカウントは消さず_もう一度呼ぶと続きから消せる", async () => {
    const { d } = deleteDeps();
    const cookie = cookieHeader(await login(d));
    let fail = true;
    d.purge = async () => {
      if (fail) throw new Error("MARKER");
    };
    const failed = await remove(d, FAKE_USER_PHRASE, cookie);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("MARKER");
    expect((await login(d)).status).toBe(200);
    fail = false;
    expect((await remove(d, FAKE_USER_PHRASE, cookie)).status).toBe(200);
    expect((await login(d)).status).toBe(401);
  });

  it("アカウントを消せない_503 を返す", async () => {
    const provider = createFakeProvider();
    const { d } = deleteDeps(provider);
    vi.spyOn(provider, "deleteAccount").mockRejectedValue(new AuthError("unavailable"));
    const cookie = cookieHeader(await login(d));
    const response = await remove(d, FAKE_USER_PHRASE, cookie);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("本文で利用者の識別子を渡す_400 で何も消さない", async () => {
    const { d, purged } = deleteDeps();
    const cookie = cookieHeader(await login(d));
    const response = await handleDeleteAccount(
      post({ password: FAKE_USER_PHRASE, sub: fakeSub(FAKE_ADMIN_EMAIL) }, { cookie }),
      d,
    );
    expect(response.status).toBe(400);
    expect(purged).toEqual([]);
  });
});
