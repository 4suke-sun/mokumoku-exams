import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_USER_EMAIL, FAKE_USER_PHRASE } from "@/lib/auth/fake.ts";
import { getAuthProvider } from "@/lib/auth/index.ts";
import { withTokenCookies } from "@/lib/auth/session.ts";
import { proxy } from "./proxy.ts";

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${path}`, { headers });

async function loginCookie(): Promise<{ header: string; refreshOnly: string }> {
  const result = await getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
  if (result.kind !== "signed-in") throw new Error("unexpected");
  const { tokens } = result;
  return {
    header: withTokenCookies(null, tokens),
    refreshOnly: `mokumoku_refresh=${encodeURIComponent(tokens.refreshToken ?? "")}`,
  };
}

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("未ログインで画面を開く_元の場所を付けてログイン画面へ相対のまま移す", async () => {
    const response = await proxy(request("/exams/EX-SMP-XX?mode=all"));
    expect(response.status).toBe(307);
    // 絶対 URL で返す(Next が同じホストのものを相対の Location に直す)。ホスト以外は、この形になる
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.pathname}${location.search}`).toBe("/login?next=%2Fexams%2FEX-SMP-XX%3Fmode%3Dall");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("未ログインで API を呼ぶ_401 で断る", async () => {
    const response = await proxy(request("/api/history/results?examCode=EX-SMP-XX"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it.each([
    "/login",
    "/forgot-password",
    "/api/auth/login",
    "/api/auth/new-password",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/refresh",
    "/api/auth/logout",
    "/api/auth/session",
    "/_next/static/a.js",
  ])("ログインなしで開ける_%s", async (path) => {
    const response = await proxy(request(path));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/api/auth/change-password", "/api/auth/unknown", "/api/auth/Login", "/api/auth/login/"])(
    "公開の列挙にない認証の API を未ログインで呼ぶ_401 で断る_%s",
    async (path) => {
      const response = await proxy(request(path));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    },
  );

  it("パスワードの変更 API_ログイン済みなら通す", async () => {
    const { header } = await loginCookie();
    const response = await proxy(request("/api/auth/change-password", { cookie: header }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("ログイン済み_通す", async () => {
    const { header } = await loginCookie();
    const response = await proxy(request("/exams", { cookie: header }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("ID トークンが消えていてリフレッシュトークンが有効_更新して通し_新しい Cookie を返す", async () => {
    const { refreshOnly } = await loginCookie();
    const response = await proxy(request("/exams", { cookie: refreshOnly }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("mokumoku_id=");
  });

  it("壊れたトークン_ログイン画面へ移す", async () => {
    const response = await proxy(request("/exams", { cookie: "mokumoku_id=forged" }));
    expect(response.status).toBe(307);
  });

  it("認証の設定がない_503 で断る(通す側には倒さない)", async () => {
    vi.stubEnv("AUTH_FAKE", "");
    vi.stubEnv("COGNITO_CLIENT_ID", "");
    vi.stubEnv("COGNITO_USER_POOL_ID", "");
    const response = await proxy(request("/exams"));
    expect(response.status).toBe(503);
  });

  it("本番で合言葉が合わない_ログインの有無にかかわらず 403 で断る", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ORIGIN_VERIFY_VALUE", "expected-value");
    expect((await proxy(request("/login"))).status).toBe(403);
  });
});
