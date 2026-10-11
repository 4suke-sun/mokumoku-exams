import { z } from "zod";
import { clearedCookies, isExpired, readClaims, readCookies, sessionCookies } from "./session.ts";
import { AuthError, type AuthErrorCode, type AuthProvider, type Tokens } from "./types.ts";

export type Deps = { provider: AuthProvider; secure: boolean; now: () => number };

const STATUS: Record<AuthErrorCode, number> = {
  "invalid-credentials": 401,
  "password-policy": 400,
  "code-invalid": 400,
  "code-expired": 400,
  "session-expired": 401,
  "limit-exceeded": 429,
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
};

function json(body: unknown, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(error: unknown): Response {
  // 原因の詳細は返さない。種類だけを返す
  const code: AuthErrorCode = error instanceof AuthError ? error.code : "unavailable";
  return json({ error: code }, STATUS[code]);
}

/**
 * 状態を変える操作の入り口の確認。JSON だけを受け付け、ブラウザが別サイトからの送信と示したものを断る
 * (Cookie は SameSite=Lax でも守られる。これは重ねた防御)。
 */
function guard(request: Request): Response | null {
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

/** 現在のログイン状態。期限切れでも更新できればログイン中として返す。更新できなければ Cookie を破棄する。 */
export async function handleSession(request: Request, deps: Deps): Promise<Response> {
  const active = await activeTokens(request, deps);
  if (!active) {
    const hadCookie = Object.values(readCookies(request.headers.get("cookie"))).some(Boolean);
    return json({ signedIn: false }, 200, hadCookie ? clearedCookies(deps.secure) : []);
  }
  const { exp, email: address } = readClaims(active.tokens.idToken);
  return json({ signedIn: true, email: address ?? null, expiresAt: exp ?? null }, 200, active.cookies);
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
    if (error instanceof AuthError && error.code === "unavailable") return failure(error);
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
