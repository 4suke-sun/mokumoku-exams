import type { z } from "zod";
import { authenticateAdmin } from "@/lib/auth/admin.ts";
import { type Authenticated, authenticate, type GuardDeps } from "@/lib/auth/guard.ts";
import { guard, json } from "@/lib/auth/handlers.ts";
import { logApiFailure } from "./log.ts";

/**
 * 履歴・管理者・通知の API の共通の入口。認証の確認、問い合わせと本文の検査、エラー応答、失敗の記録を、ここに集める。
 *
 * エラー応答の形は `{ "error": "<種類>" }` だけ。原因・内部の情報・入力の値は返さない。
 * 種類とステータス: bad-request 400(入力が正しくない)/ self-disable 400(自分自身の無効化)/ unauthorized 401 /
 * forbidden 403(管理者でない・別サイトからの送信)/ not-found 404 / already-exists 409 / too-large 413 /
 * bad-request 415(JSON でない形式)/ limit-exceeded 429 / unavailable 503(保存先などの失敗)。
 */
export type ApiError =
  | "bad-request"
  | "self-disable"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "already-exists"
  | "too-large"
  | "limit-exceeded"
  | "unavailable";

export const fail = (error: ApiError, status: number, cookies: string[] = []) => json({ error }, status, cookies);

/** 保存先などの例外。経路・状態・例外の名前だけを記録してから、503 を返す(原因は応答に含めない) */
export function unavailable(request: Request, error: unknown, cookies: string[] = []): Response {
  logApiFailure(request, 503, error);
  return fail("unavailable", 503, cookies);
}

/**
 * 誰に許すか。
 * - `user`: ログイン中の利用者。未ログインは 401。
 * - `admin`: 管理者。未ログインは 401、管理者でない利用者は 403。
 * - `admin-only`: 管理者。未ログインも管理者でない利用者も、区別せずに 403(管理者の API)。
 */
export type Access = "user" | "admin" | "admin-only";

type AuthDeps = { auth: GuardDeps };

/**
 * 利用者を、サーバー側で検証した ID トークンで確かめる。利用者の識別子(`sub`)は、ここで得たものだけを使う
 * (リクエストの本文・パラメーターからは受け取らない)。検証できないときは、通す側には倒さない。
 */
export async function authorize(request: Request, deps: AuthDeps, access: Access): Promise<Authenticated | Response> {
  const cookie = request.headers.get("cookie");
  if (access !== "user") {
    const admin = await authenticateAdmin(cookie, deps.auth).catch(() => null);
    if (admin) return admin;
    if (access === "admin-only") return fail("forbidden", 403);
  }
  const user = await authenticate(cookie, deps.auth).catch(() => null);
  if (!user) return fail("unauthorized", 401);
  return access === "user" ? user : fail("forbidden", 403, user.setCookies);
}

/** 問い合わせを検査する。同じ名前が 2 回以上あるものは、どちらを使うか曖昧なので断る。 */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.infer<S> | null {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([name]) => name)).size !== entries.length) return null;
  const parsed = schema.safeParse(Object.fromEntries(entries));
  return parsed.success ? parsed.data : null;
}

/**
 * 本文を、大きさを確かめてから JSON として読み、スキーマで検査する。大きさは、読み込む前に申告で、読み込んだあとに
 * 実際の大きさで確かめる。断るときは、その応答を返す。
 */
export async function readBody<S extends z.ZodType>(
  request: Request,
  maxBytes: number,
  schema: S,
  cookies: string[],
): Promise<{ value: z.infer<S> } | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) return fail("too-large", 413, cookies);
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > maxBytes) return fail("too-large", 413, cookies);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("bad-request", 400, cookies);
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? { value: parsed.data } : fail("bad-request", 400, cookies);
}

/** 読み出しの入口。利用者を確かめ、問い合わせを検査する。 */
export async function acceptQuery<S extends z.ZodType>(
  request: Request,
  deps: AuthDeps,
  options: { access: Access; query: S },
): Promise<{ auth: Authenticated; query: z.infer<S> } | Response> {
  const auth = await authorize(request, deps, options.access);
  if (auth instanceof Response) return auth;
  const query = parseQuery(request, options.query);
  return query === null ? fail("bad-request", 400, auth.setCookies) : { auth, query };
}

/** 状態を変える操作の入口。JSON だけを受け付け、利用者を確かめてから、本文を読んで検査する。 */
export async function acceptBody<S extends z.ZodType>(
  request: Request,
  deps: AuthDeps,
  options: { access: Access; maxBytes: number; body: S },
): Promise<{ auth: Authenticated; body: z.infer<S> } | Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps, options.access);
  if (auth instanceof Response) return auth;
  const read = await readBody(request, options.maxBytes, options.body, auth.setCookies);
  return read instanceof Response ? read : { auth, body: read.value };
}
