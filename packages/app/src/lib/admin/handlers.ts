import { z } from "zod";
import { acceptBody, acceptQuery, fail, unavailable } from "@/lib/api/endpoint.ts";
import type { GuardDeps } from "@/lib/auth/guard.ts";
import { json } from "@/lib/auth/handlers.ts";
import { type ManagedUser, type UserAdmin, UserAdminError } from "@/lib/auth/user-admin.ts";
import { SUB_PATTERN } from "@/lib/auth/verify.ts";
import { EmptyQuerySchema } from "@/lib/history/schema.ts";
import type { AuditLog } from "./audit.ts";

export type AdminDeps = { auth: GuardDeps; users: UserAdmin; audit: AuditLog; now?: () => number };

// エラー応答の形と種類は、ほかの API と同じ(lib/api/endpoint.ts)。未ログインも管理者でない利用者も、区別せずに 403 にする。

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

/** 操作の失敗を応答にする。503 にするもの(種類のわからない失敗を含む)は、経路・状態・例外の名前だけを記録する */
function failure(request: Request, error: unknown, cookies: string[]): Response {
  if (error instanceof UserAdminError && error.code !== "unavailable")
    return fail(error.code, STATUS[error.code], cookies);
  return unavailable(request, error, cookies);
}

export const InviteSchema = z.strictObject({
  email: z.string().trim().max(254).pipe(z.email()),
});
export const DisableSchema = z.strictObject({ username: z.string().regex(SUB_PATTERN) });

/** 一覧の 1 行。`self` は、操作している管理者自身か(画面で無効化の操作を出さないため) */
export type AdminUserRow = ManagedUser & { self: boolean };

const newestFirst = (a: ManagedUser, b: ManagedUser) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "");

/** 利用者の一覧(メールアドレス、状態、作成日)。作成日の新しい順。問い合わせのパラメーターは受け付けない。 */
export async function handleListUsers(request: Request, deps: AdminDeps): Promise<Response> {
  const accepted = await acceptQuery(request, deps, { access: "admin-only", query: EmptyQuerySchema });
  if (accepted instanceof Response) return accepted;
  const { auth } = accepted;
  try {
    const users = await deps.users.listUsers();
    const rows: AdminUserRow[] = users
      .sort(newestFirst)
      .map((user) => ({ ...user, self: user.username === auth.user.sub }));
    return json({ users: rows }, 200, auth.setCookies);
  } catch (error) {
    return failure(request, error, auth.setCookies);
  }
}

/** メールアドレスで招待する。Cognito が招待メール(仮パスワードつき)を送る。 */
export async function handleInviteUser(request: Request, deps: AdminDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "admin-only",
    maxBytes: MAX_ADMIN_BODY_BYTES,
    body: InviteSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body: input } = accepted;
  try {
    const user = await deps.users.inviteUser(input.email);
    return json({ user }, 200, auth.setCookies);
  } catch (error) {
    return failure(request, error, auth.setCookies);
  }
}

/**
 * 利用者を無効にし、操作の記録を残す。自分自身は無効にできない。操作した管理者は、検証した ID トークンの `sub` だけで決める
 * (本文からは受け取らない)。記録が残せなかったときは 503 を返す(無効化そのものは済んでいることがある)。
 */
export async function handleDisableUser(request: Request, deps: AdminDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "admin-only",
    maxBytes: MAX_ADMIN_BODY_BYTES,
    body: DisableSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body: input } = accepted;
  if (input.username === auth.user.sub) return fail("self-disable", STATUS["self-disable"], auth.setCookies);
  try {
    await deps.users.disableUser(input.username);
  } catch (error) {
    return failure(request, error, auth.setCookies);
  }
  try {
    await deps.audit.record({
      at: new Date((deps.now ?? Date.now)()).toISOString(),
      actor: auth.user.sub,
      target: input.username,
      action: "disable-user",
    });
  } catch (error) {
    return failure(request, error, auth.setCookies);
  }
  return json({ status: "disabled" }, 200, auth.setCookies);
}
