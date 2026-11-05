import { z } from "zod";
import { ownerTag } from "../owner-tag.ts";
import { ADMIN_GROUP } from "./admin.ts";
import { authenticate } from "./guard.ts";
import { clearedCookies, isExpired, readClaims, readCookies, sessionCookies } from "./session.ts";
import { AuthError, type AuthErrorCode, type AuthProvider, authErrorCode, type Tokens } from "./types.ts";
import { isStaleUnconfirmed, type UserAdmin } from "./user-admin.ts";
import type { TokenVerifier } from "./verify.ts";

export type Deps = { provider: AuthProvider; secure: boolean; now: () => number };

/** 登録の API の依存。登録済みのメールアドレスのとき、状態を読み、条件に合えば古い未確認のアカウントを消す */
export type SignUpDeps = Deps & { users: Pick<UserAdmin, "getSignUpState" | "deleteStaleUnconfirmed"> };

/**
 * 退会の API の依存。`verifier` は、Cookie の ID トークンを検証して本人(`sub` とメールアドレス)を得るため。
 * `purge` は、利用者の区画(`PK=USER#{sub}`)のデータをすべて消す(消し済みのものを消しても、結果は変わらない)。
 */
export type DeleteAccountDeps = Deps & { verifier: TokenVerifier; purge: (sub: string) => Promise<void> };

// 種類から応答の状態への対応
const STATUS: Record<AuthErrorCode, number> = {
  "invalid-credentials": 401,
  "not-confirmed": 403,
  "already-exists": 409,
  "password-policy": 400,
  "code-invalid": 400,
  "code-expired": 400,
  "session-expired": 401,
  "limit-exceeded": 429,
  "send-limit": 429,
  unavailable: 503,
};

// 入力は外部の値なので、形と大きさを検査する(パスワードの規則そのものは Cognito が判断する)
const email = z.string().trim().min(3).max(254);
const secret = z.string().min(1).max(256);
const Schemas = {
  login: z.strictObject({ email, password: secret }),
  newPassword: z.strictObject({
    username: z.string().min(1).max(256),
    session: z.string().min(1).max(4096),
    newPassword: secret,
  }),
  forgot: z.strictObject({ email }),
  reset: z.strictObject({ email, code: z.string().trim().min(1).max(32), newPassword: secret }),
  changePassword: z.strictObject({ previousPassword: secret, proposedPassword: secret }),
  signUp: z.strictObject({ email, password: secret }),
  confirmSignUp: z.strictObject({ email, code: z.string().trim().min(1).max(32), password: secret }),
  resendCode: z.strictObject({ email }),
  deleteAccount: z.strictObject({ password: secret }),
};

export function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(error: unknown, cookies: string[] = []): Response {
  // 原因の詳細は返さない。種類だけを返す
  const code: AuthErrorCode = authErrorCode(error) ?? "unavailable";
  return json({ error: code }, STATUS[code], cookies);
}

/**
 * 状態を変える操作の入り口の確認。JSON だけを受け付け、ブラウザが別サイトからの送信と示したものを断る
 * (Cookie は SameSite=Lax でも守られる。これは重ねた防御)。
 */
export function guard(request: Request): Response | null {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "bad-request" }, 415);
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return json({ error: "forbidden" }, 403);
  return null;
}

async function parse<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S> | Response> {
  const guarded = guard(request);
  if (guarded) return guarded;
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  return parsed.success ? parsed.data : json({ error: "bad-request" }, 400);
}

export async function handleLogin(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.login);
  if (input instanceof Response) return input;
  try {
    const result = await deps.provider.signIn(input.email, input.password);
    if (result.kind === "new-password-required") {
      return json({ status: "new-password-required", session: result.session, username: result.username });
    }
    return json({ status: "signed-in" }, 200, sessionCookies(result.tokens, deps.secure));
  } catch (error) {
    return failure(error);
  }
}

export async function handleNewPassword(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.newPassword);
  if (input instanceof Response) return input;
  try {
    const tokens = await deps.provider.completeNewPassword(input);
    return json({ status: "signed-in" }, 200, sessionCookies(tokens, deps.secure));
  } catch (error) {
    return failure(error);
  }
}

export async function handleForgotPassword(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.forgot);
  if (input instanceof Response) return input;
  try {
    await deps.provider.requestPasswordReset(input.email);
    return json({ status: "sent" });
  } catch (error) {
    return failure(error);
  }
}

export async function handleResetPassword(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.reset);
  if (input instanceof Response) return input;
  try {
    await deps.provider.confirmPasswordReset({ email: input.email, code: input.code, newPassword: input.newPassword });
    return json({ status: "reset" });
  } catch (error) {
    return failure(error);
  }
}

/** ログアウト。サーバー側でリフレッシュトークンを無効にし、Cookie を破棄する(無効にできなくても Cookie は消す)。 */
export async function handleLogout(request: Request, deps: Deps): Promise<Response> {
  const guarded = guard(request);
  if (guarded) return guarded;
  const { refresh } = readCookies(request.headers.get("cookie"));
  if (refresh) await deps.provider.signOut(refresh).catch(() => undefined);
  return json({ status: "signed-out" }, 200, clearedCookies(deps.secure));
}

type Active = { tokens: Pick<Tokens, "idToken" | "accessToken">; cookies: string[] };

/** 有効なトークンを返す。期限切れなら、リフレッシュトークンで更新する。更新できなければ null。 */
async function activeTokens(request: Request, deps: Deps): Promise<Active | null> {
  const { id, access, refresh } = readCookies(request.headers.get("cookie"));
  if (id && access && !isExpired(readClaims(id).exp, deps.now()))
    return { tokens: { idToken: id, accessToken: access }, cookies: [] };
  if (!refresh) return null;
  try {
    const tokens = await deps.provider.refresh(refresh);
    return { tokens, cookies: sessionCookies(tokens, deps.secure) };
  } catch {
    return null;
  }
}

/**
 * 現在のログイン状態。期限切れでも更新できればログイン中として返す。更新できなければ Cookie を破棄する。
 * `isAdmin` は、ナビゲーションの表示のためだけの値。管理者の経路の認可は、proxy と管理者の画面が、検証したトークンで行う。
 * `owner` は、端末の記録を持ち主ごとに分けるための印(`sub` から作る。識別子そのものは返さない)。認可の判断には使わない。
 */
export async function handleSession(request: Request, deps: Deps): Promise<Response> {
  const active = await activeTokens(request, deps);
  if (!active) {
    const hadCookie = Object.values(readCookies(request.headers.get("cookie"))).some(Boolean);
    return json({ signedIn: false }, 200, hadCookie ? clearedCookies(deps.secure) : []);
  }
  const { exp, email: address, groups, sub } = readClaims(active.tokens.idToken);
  return json(
    {
      signedIn: true,
      email: address ?? null,
      expiresAt: exp ?? null,
      isAdmin: groups?.includes(ADMIN_GROUP) ?? false,
      owner: sub ? ownerTag(sub) : null,
    },
    200,
    active.cookies,
  );
}

/** 期限の前の更新。ログイン中でなければ 401 にして Cookie を破棄する。 */
export async function handleRefresh(request: Request, deps: Deps): Promise<Response> {
  const guarded = guard(request);
  if (guarded) return guarded;
  const { refresh } = readCookies(request.headers.get("cookie"));
  if (!refresh) return json({ error: "session-expired" }, 401, clearedCookies(deps.secure));
  try {
    const tokens = await deps.provider.refresh(refresh);
    return json(
      { status: "refreshed", expiresAt: readClaims(tokens.idToken).exp ?? null },
      200,
      sessionCookies(tokens, deps.secure),
    );
  } catch (error) {
    if (authErrorCode(error) === "unavailable") return failure(error);
    return json({ error: "session-expired" }, 401, clearedCookies(deps.secure));
  }
}

export async function handleChangePassword(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.changePassword);
  if (input instanceof Response) return input;
  const active = await activeTokens(request, deps);
  if (!active) return json({ error: "session-expired" }, 401, clearedCookies(deps.secure));
  try {
    await deps.provider.changePassword({
      accessToken: active.tokens.accessToken,
      previousPassword: input.previousPassword,
      proposedPassword: input.proposedPassword,
    });
    return json({ status: "changed" }, 200, active.cookies);
  } catch (error) {
    return failure(error);
  }
}

/**
 * 登録済みのメールアドレスでの登録(登録し直し)を、次の順に扱う。
 * 1. 状態を読む。未確認でなければ、パスワードを試さずに 4 へ(確認済みのアカウントについて、パスワードを試す経路にしない)。
 * 2. 未確認なら、受け取ったパスワードでログインを試す。確認がまだと返れば、本人の登録し直しとみなし、確認コードを送り直す。
 *    万一トークンが返っても、捨てて Cookie を付けない。
 * 3. パスワードが違い、作成から 24 時間たっていれば、古い登録を消してから、もう一度登録する。
 * 4. どれでもなければ、登録できない(`already-exists`)。
 */
async function signUpAgain(email: string, password: string, deps: SignUpDeps): Promise<void> {
  const state = await deps.users.getSignUpState(email);
  if (state?.status !== "UNCONFIRMED") throw new AuthError("already-exists");
  try {
    await deps.provider.signIn(email, password);
  } catch (error) {
    if (authErrorCode(error) === "not-confirmed") {
      await deps.provider.resendCode(email);
      return;
    }
    // パスワードの違い(認証の失敗)だけを 3 へ進める。回数の制限や接続の失敗は、そのまま伝える
    if (authErrorCode(error) !== "invalid-credentials") throw error;
  }
  if (isStaleUnconfirmed(state, deps.now()) && (await deps.users.deleteStaleUnconfirmed(email, deps.now()))) {
    await deps.provider.signUp(email, password);
    return;
  }
  throw new AuthError("already-exists");
}

/** 新規登録。確認コードをメールで送る。登録済みのメールアドレスは、`signUpAgain` の順で扱う。 */
export async function handleSignUp(request: Request, deps: SignUpDeps): Promise<Response> {
  const input = await parse(request, Schemas.signUp);
  if (input instanceof Response) return input;
  try {
    try {
      await deps.provider.signUp(input.email, input.password);
    } catch (error) {
      if (authErrorCode(error) !== "already-exists") throw error;
      await signUpAgain(input.email, input.password, deps);
    }
    return json({ status: "code-sent" });
  } catch (error) {
    return failure(error);
  }
}

/**
 * 確認コードで登録を確かめ、続けてログインして Cookie を付ける。確認は通ったがログインできなかったとき
 * (登録とは別のパスワードを送ったときなど)は、Cookie を付けずに `confirmed` を返す(画面は、ログインの画面へ移す)。
 */
export async function handleConfirmSignUp(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.confirmSignUp);
  if (input instanceof Response) return input;
  try {
    await deps.provider.confirmSignUp({ email: input.email, code: input.code });
  } catch (error) {
    return failure(error);
  }
  try {
    const result = await deps.provider.signIn(input.email, input.password);
    if (result.kind === "signed-in") {
      return json({ status: "signed-in" }, 200, sessionCookies(result.tokens, deps.secure));
    }
  } catch {
    // 下の応答にする
  }
  return json({ status: "confirmed" });
}

/** 確認コードを送り直す。登録のないメールアドレスでも、送ったと同じ応答にする。 */
export async function handleResendCode(request: Request, deps: Deps): Promise<Response> {
  const input = await parse(request, Schemas.resendCode);
  if (input instanceof Response) return input;
  try {
    await deps.provider.resendCode(input.email);
    return json({ status: "sent" });
  } catch (error) {
    return failure(error);
  }
}

/**
 * 退会。パスワードで認証し直す → 利用者の区画のデータを消す → Cognito のアカウントを消す → Cookie を破棄する。
 * 本人は、検証した ID トークンの `sub` だけで決める(本文からは受け取らない)。データかアカウントを消せなかったときは 503 を返す
 * (もう一度呼べば、続きから消せる)。
 */
export async function handleDeleteAccount(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  const input = await parse(request, Schemas.deleteAccount);
  if (input instanceof Response) return input;
  const auth = await authenticate(request.headers.get("cookie"), {
    verifier: deps.verifier,
    provider: deps.provider,
    secure: deps.secure,
  }).catch(() => null);
  if (!auth?.user.email) return json({ error: "session-expired" }, 401, clearedCookies(deps.secure));
  let tokens: Tokens;
  try {
    const result = await deps.provider.signIn(auth.user.email, input.password);
    if (result.kind !== "signed-in") throw new AuthError("invalid-credentials");
    tokens = result.tokens;
  } catch (error) {
    return failure(error, auth.setCookies);
  }
  // 認証し直した相手が、ログイン中の本人と違うときは、何も消さない
  if (readClaims(tokens.idToken).sub !== auth.user.sub) {
    return failure(new AuthError("invalid-credentials"), auth.setCookies);
  }
  try {
    await deps.purge(auth.user.sub);
    await deps.provider.deleteAccount(tokens.accessToken);
  } catch {
    return json({ error: "unavailable" }, 503, auth.setCookies);
  }
  return json({ status: "deleted" }, 200, clearedCookies(deps.secure));
}
