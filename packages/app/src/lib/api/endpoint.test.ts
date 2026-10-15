import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { acceptBody, acceptQuery, authorize, readBody, unavailable } from "./endpoint.ts";

const ORIGIN = "http://localhost";

/** トークンの文字列から利用者を決める検証。`admin-` で始まる利用者だけを、管理者のグループに入れる */
const verifier: TokenVerifier = {
  async verifyIdToken(token) {
    if (!token.startsWith("token-")) return null;
    const sub = token.slice("token-".length);
    return { sub, groups: sub.startsWith("admin-") ? ["admins"] : [] };
  },
};
const noRefresh = {
  async refresh() {
    throw new Error("unavailable");
  },
} as unknown as AuthProvider;
const deps = { auth: { verifier, provider: noRefresh, secure: false } };
const asUser = (sub: string) => `mokumoku_id=token-${sub}`;

const get = (query: string, cookie?: string) =>
  new Request(`${ORIGIN}/api/example${query}`, { headers: cookie ? { cookie } : {} });
const post = (raw: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/example`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
const statusOf = (value: unknown) => (value instanceof Response ? value.status : 200);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API の入口の認証", () => {
  it("利用者の API_未ログインは 401_ログイン中は通す", async () => {
    expect(statusOf(await authorize(get(""), deps, "user"))).toBe(401);
    expect(statusOf(await authorize(get("", asUser("user-a")), deps, "user"))).toBe(200);
  });

  it("管理者の操作_未ログインは 401_管理者でない利用者は 403_管理者は通す", async () => {
    expect(statusOf(await authorize(get(""), deps, "admin"))).toBe(401);
    expect(statusOf(await authorize(get("", asUser("user-a")), deps, "admin"))).toBe(403);
    expect(statusOf(await authorize(get("", asUser("admin-a")), deps, "admin"))).toBe(200);
  });

  it("管理者の API_未ログインも管理者でない利用者も 403_管理者は通す", async () => {
    expect(statusOf(await authorize(get(""), deps, "admin-only"))).toBe(403);
    expect(statusOf(await authorize(get("", asUser("user-a")), deps, "admin-only"))).toBe(403);
    expect(statusOf(await authorize(get("", asUser("admin-a")), deps, "admin-only"))).toBe(200);
  });

  it("検証が例外になる_通す側に倒さず 401 にする", async () => {
    const broken = {
      auth: {
        ...deps.auth,
        verifier: {
          async verifyIdToken() {
            throw new Error("detail");
          },
        },
      },
    };
    expect(statusOf(await authorize(get("", asUser("admin-a")), broken, "admin"))).toBe(401);
  });
});

describe("API の入口の問い合わせと本文", () => {
  const Query = z.strictObject({ examCode: z.string() });
  const Body = z.strictObject({ value: z.number() });

  it("問い合わせが正しい_検査した値を返す_同じ名前が 2 回あれば 400", async () => {
    const ok = await acceptQuery(get("?examCode=EX", asUser("user-a")), deps, { access: "user", query: Query });
    expect(ok).toMatchObject({ query: { examCode: "EX" }, auth: { user: { sub: "user-a" } } });
    const twice = await acceptQuery(get("?examCode=EX&examCode=EY", asUser("user-a")), deps, {
      access: "user",
      query: Query,
    });
    expect(statusOf(twice)).toBe(400);
  });

  it("本文の大きさ・形式・スキーマが外れる_413 か 400 を返す", async () => {
    expect(statusOf(await readBody(post("x".repeat(20)), 10, Body, []))).toBe(413);
    expect(statusOf(await readBody(post("{"), 100, Body, []))).toBe(400);
    expect(statusOf(await readBody(post('{"value":"1"}'), 100, Body, []))).toBe(400);
    expect(await readBody(post('{"value":1}'), 100, Body, [])).toEqual({ value: { value: 1 } });
  });

  it("状態を変える操作_JSON でない形式は 415_別サイトからは 403_認証の前に断る", async () => {
    const options = { access: "user" as const, maxBytes: 100, body: Body };
    const plain = new Request(`${ORIGIN}/api/example`, { method: "POST", body: "{}" });
    expect(statusOf(await acceptBody(plain, deps, options))).toBe(415);
    expect(statusOf(await acceptBody(post('{"value":1}', { "sec-fetch-site": "cross-site" }), deps, options))).toBe(
      403,
    );
    expect(statusOf(await acceptBody(post('{"value":1}'), deps, options))).toBe(401);
    expect(await acceptBody(post('{"value":1}', { cookie: asUser("user-a") }), deps, options)).toMatchObject({
      body: { value: 1 },
    });
  });

  it("保存先の失敗_503 を返し_失敗を 1 行だけ記録する", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = unavailable(get(""), new Error("detail"), ["a=b"]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(response.headers.get("set-cookie")).toBe("a=b");
    expect(log).toHaveBeenCalledTimes(1);
  });
});
