import { z } from "zod";
import { authenticateAdmin } from "@/lib/auth/admin.ts";
import type { GuardDeps } from "@/lib/auth/guard.ts";
import { guard, json } from "@/lib/auth/handlers.ts";
import { type ManagedUser, type UserAdmin, UserAdminError } from "@/lib/auth/user-admin.ts";
import { SUB_PATTERN } from "@/lib/auth/verify.ts";
import type { AuditLog } from "./audit.ts";

export type AdminDeps = { auth: GuardDeps; users: UserAdmin; audit: AuditLog; now?: () => number };

/**
 * エラー応答の形は `{ "error": "<種類>" }` だけ。原因・内部の情報・入力の値は返さない。
 * 種類とステータス: bad-request 400 / self-disable 400(自分自身の無効化)/ forbidden 403(管理者でない・未ログイン・別サイトからの送信)/
 * not-found 404 / already-exists 409 / too-large 413 / limit-exceeded 429 / unavailable 503。
 */
export type AdminError =
  | "bad-request"
  | "self-disable"
  | "forbidden"
  | "not-found"
  | "already-exists"
  | "too-large"
  | "limit-exceeded"
  | "unavailable";

const STATUS: Record<AdminError, number> = {
  "bad-request": 400,
  "self-disable": 400,
  forbidden: 403,
  "not-found": 404,
  "already-exists": 409,
  "too-large": 413,
  "limit-exceeded": 429,
  unavailable: 503,
};

/** 本文の上限(メールアドレスかユーザー名だけを受け取る) */
export const MAX_ADMIN_BODY_BYTES = 1024;

const fail = (error: AdminError, cookies: string[] = []) => json({ error }, STATUS[error], cookies);

const failure = (error: unknown, cookies: string[]) =>
  fail(error instanceof UserAdminError ? error.code : "unavailable", cookies);

export const InviteSchema = z.strictObject({
  email: z.string().trim().max(254).pipe(z.email()),
});
export const DisableSchema = z.strictObject({ username: z.string().regex(SUB_PATTERN) });

/** 一覧の 1 行。`self` は、操作している管理者自身か(画面で無効化の操作を出さないため) */
export type AdminUserRow = ManagedUser & { self: boolean };

/**
 * 管理者を、サーバー側で検証した ID トークンで確かめる(入口の proxy とは別に、API の本体でも確かめる)。
 * 管理者でないとき・未ログインのときは、どちらも null(403 にする)。
 */
async function authorize(request: Request, deps: AdminDeps) {
  try {
    return await authenticateAdmin(request.headers.get("cookie"), deps.auth);
  } catch {
    return null;
  }
}

/** 本文を、大きさを確かめてから JSON として読み、スキーマで検査する。断るときは、その応答を返す。 */
async function readBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  cookies: string[],
): Promise<z.infer<S> | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ADMIN_BODY_BYTES) return fail("too-large", cookies);
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_ADMIN_BODY_BYTES) return fail("too-large", cookies);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("bad-request", cookies);
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : fail("bad-request", cookies);
}

const newestFirst = (a: ManagedUser, b: ManagedUser) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

/** 利用者の一覧(メールアドレス、状態、作成日)。作成日の新しい順。問い合わせのパラメーターは受け付けない。 */
export async function handleListUsers(request: Request, deps: AdminDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (!auth) return fail("forbidden");
  if ([...new URL(request.url).searchParams.keys()].length > 0) return fail("bad-request", auth.setCookies);
  try {
    const users = await deps.users.listUsers();
    const rows: AdminUserRow[] = users
      .sort(newestFirst)
      .map((user) => ({ ...user, self: user.username === auth.user.sub }));
    return json({ users: rows }, 200, auth.setCookies);
  } catch (error) {
    return failure(error, auth.setCookies);
  }
}

/** メールアドレスで招待する。Cognito が招待メール(仮パスワードつき)を送る。 */
export async function handleInviteUser(request: Request, deps: AdminDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return fail("forbidden");
  const input = await readBody(request, InviteSchema, auth.setCookies);
  if (input instanceof Response) return input;
  try {
    const user = await deps.users.inviteUser(input.email);
    return json({ user }, 200, auth.setCookies);
  } catch (error) {
    return failure(error, auth.setCookies);
  }
}

/**
 * 利用者を無効にし、操作の記録を残す。自分自身は無効にできない。操作した管理者は、検証した ID トークンの `sub` だけで決める
 * (本文からは受け取らない)。記録が残せなかったときは 503 を返す(無効化そのものは済んでいることがある)。
 */
export async function handleDisableUser(request: Request, deps: AdminDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return fail("forbidden");
  const input = await readBody(request, DisableSchema, auth.setCookies);
  if (input instanceof Response) return input;
  if (input.username === auth.user.sub) return fail("self-disable", auth.setCookies);
  try {
    await deps.users.disableUser(input.username);
  } catch (error) {
    return failure(error, auth.setCookies);
  }
  try {
    await deps.audit.record({
      at: new Date((deps.now ?? Date.now)()).toISOString(),
      actor: auth.user.sub,
      target: input.username,
      action: "disable-user",
    });
  } catch {
    return fail("unavailable", auth.setCookies);
  }
  return json({ status: "disabled" }, 200, auth.setCookies);
}
