import type { z } from "zod";

/**
 * API の呼び出しの結果。失敗は、ログインの期限切れ(401)と、そのほかの失敗(通信の失敗・サーバーの失敗・応答の形の不一致)を
 * 区別する。`status` は応答の状態(通信の失敗は 0)、`code` はサーバーが返したエラーの種類(`{ "error": "<種類>" }`)。
 */
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;
export type ApiFailure = { ok: false; kind: "session-expired" | "failed"; status: number; code: string | null };

type Options<S extends z.ZodType | undefined> = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** JSON にして送る本文。あれば `content-type: application/json` を付ける */
  body?: unknown;
  /** 成功の応答の形。省くと、本文を読まない(`data` は undefined) */
  schema?: S;
};

const failure = (status: number, code: string | null = null): ApiFailure => ({
  ok: false,
  kind: status === 401 ? "session-expired" : "failed",
  status,
  code,
});

async function errorCode(response: Response): Promise<string | null> {
  const body: unknown = await response.json().catch(() => null);
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : null;
}

/** API を呼び、状態を確かめ、成功の応答をスキーマで検査する。例外は投げない。 */
export async function requestJson<S extends z.ZodType | undefined = undefined>(
  path: string,
  options: Options<S> = {},
): Promise<ApiResult<S extends z.ZodType ? z.infer<S> : undefined>> {
  type Data = S extends z.ZodType ? z.infer<S> : undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      cache: "no-store",
      ...(options.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(options.body) }),
    });
  } catch {
    return failure(0);
  }
  if (!response.ok) return failure(response.status, await errorCode(response));
  if (!options.schema) return { ok: true, data: undefined as Data };
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = options.schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data as Data } : failure(response.status);
}
