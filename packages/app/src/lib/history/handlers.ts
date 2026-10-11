import { authenticate, type GuardDeps } from "@/lib/auth/guard.ts";
import { guard, json } from "@/lib/auth/handlers.ts";
import type { HistoryRepository } from "./repository.ts";
import { ApiResultSchema, ListQuerySchema, MAX_BODY_BYTES } from "./schema.ts";

export type HistoryDeps = { auth: GuardDeps; repository: HistoryRepository };

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

const unauthorized = () => json({ error: "unauthorized" }, 401);
const unavailable = () => json({ error: "unavailable" }, 503);

/** 自分の結果を、資格ごとに新しい順で返す。 */
export async function handleListResults(request: Request, deps: HistoryDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (!auth) return unauthorized();
  const query = ListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return json({ error: "bad-request" }, 400, auth.setCookies);
  try {
    const results = await deps.repository.listResults(auth.user.sub, query.data.examCode);
    return json({ results }, 200, auth.setCookies);
  } catch {
    return unavailable();
  }
}

/** 自分の結果を保存する。同じ資格・同じ完了時刻の結果は上書きなので、繰り返しても重複しない。 */
export async function handlePostResult(request: Request, deps: HistoryDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return unauthorized();

  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json({ error: "too-large" }, 413, auth.setCookies);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "bad-request" }, 400, auth.setCookies);
  }
  const parsed = ApiResultSchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad-request" }, 400, auth.setCookies);

  try {
    await deps.repository.putResult(auth.user.sub, parsed.data);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch {
    return unavailable();
  }
}
