import { authenticate, type GuardDeps } from "@/lib/auth/guard.ts";
import { guard, json } from "@/lib/auth/handlers.ts";
import type { HistoryRepository } from "./repository.ts";
import { apiResultSchema, ListQuerySchema, MAX_BODY_BYTES } from "./schema.ts";

export type HistoryDeps = { auth: GuardDeps; repository: HistoryRepository; now?: () => number };

/**
 * エラー応答の形は `{ "error": "<種類>" }` だけ。原因・内部の情報・入力の値は返さない。
 * 種類とステータス: bad-request 400(入力が正しくない)/ unauthorized 401 / forbidden 403(別サイトからの送信)/
 * too-large 413 / bad-request 415(JSON でない形式)/ unavailable 503(保存先の失敗)。
 */
export type HistoryError = "bad-request" | "unauthorized" | "too-large" | "unavailable";

const fail = (error: HistoryError, status: number, cookies: string[] = []) => json({ error }, status, cookies);

/**
 * ログイン中の利用者を、サーバー側で検証して得る。利用者の識別子(`sub`)は、ここで得たものだけを使う
 * (リクエストの本文・パラメーターからは受け取らない)。
 */
async function authorize(request: Request, deps: HistoryDeps) {
  try {
    return await authenticate(request.headers.get("cookie"), deps.auth);
  } catch {
    return null;
  }
}

/** 問い合わせを検査する。同じ名前が 2 回以上あるものは、どちらを使うか曖昧なので断る。 */
function parseQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([name]) => name)).size !== entries.length) return null;
  const parsed = ListQuerySchema.safeParse(Object.fromEntries(entries));
  return parsed.success ? parsed.data : null;
}

/** 自分の結果を、資格ごとに新しい順で返す。 */
export async function handleListResults(request: Request, deps: HistoryDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);
  const query = parseQuery(request);
  if (!query) return fail("bad-request", 400, auth.setCookies);
  try {
    const results = await deps.repository.listResults(auth.user.sub, query.examCode);
    return json({ results }, 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}

/** 自分の結果を保存する。同じ資格・同じ完了時刻の結果は上書きなので、繰り返しても重複しない。 */
export async function handlePostResult(request: Request, deps: HistoryDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);

  // 大きさは、読み込む前に申告で、読み込んだあとに実際の大きさで確かめる
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return fail("too-large", 413, auth.setCookies);
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return fail("too-large", 413, auth.setCookies);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail("bad-request", 400, auth.setCookies);
  }
  const parsed = apiResultSchema((deps.now ?? Date.now)()).safeParse(body);
  if (!parsed.success) return fail("bad-request", 400, auth.setCookies);

  try {
    await deps.repository.putResult(auth.user.sub, parsed.data);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}
