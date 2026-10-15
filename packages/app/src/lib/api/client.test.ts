import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { requestJson } from "./client.ts";

const Schema = z.object({ value: z.number() });

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API の呼び出し", () => {
  it("成功してスキーマに合う_検査した値を返す", async () => {
    respond(200, { value: 1 });
    expect(await requestJson("/api/example", { schema: Schema })).toEqual({ ok: true, data: { value: 1 } });
  });

  it("401 が返る_ログインの期限切れとして区別する", async () => {
    respond(401, { error: "unauthorized" });
    expect(await requestJson("/api/example", { schema: Schema })).toEqual({
      ok: false,
      kind: "session-expired",
      status: 401,
      code: "unauthorized",
    });
  });

  it("通信に失敗する_状態 0 のそのほかの失敗にする", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    expect(await requestJson("/api/example", { schema: Schema })).toEqual({
      ok: false,
      kind: "failed",
      status: 0,
      code: null,
    });
  });

  it("サーバーの失敗と形の合わない応答_そのほかの失敗にする", async () => {
    respond(503, { error: "unavailable" });
    expect(await requestJson("/api/example", { schema: Schema })).toMatchObject({
      kind: "failed",
      code: "unavailable",
    });
    respond(200, { value: "1" });
    expect(await requestJson("/api/example", { schema: Schema })).toMatchObject({ kind: "failed", status: 200 });
  });

  it("本文を送る_JSON にして送り_スキーマがなければ応答の本文を読まない", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));
    expect(await requestJson("/api/example", { method: "PUT", body: { a: 1 } })).toEqual({ ok: true, data: undefined });
    expect(fetch).toHaveBeenCalledWith("/api/example", {
      method: "PUT",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
  });
});
