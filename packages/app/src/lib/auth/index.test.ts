import { describe, expect, it } from "vitest";
import { getAuthProvider } from "./index.ts";

describe("getAuthProvider", () => {
  it("本番の設定では_AUTH_FAKE があっても代替を使わず_設定が足りなければ失敗する", () => {
    expect(() => getAuthProvider({ NODE_ENV: "production", AUTH_FAKE: "1" })).toThrow();
  });

  it("手元の開発で AUTH_FAKE=1 のとき_代替を返す", async () => {
    const provider = getAuthProvider({ NODE_ENV: "development", AUTH_FAKE: "1" });
    await expect(provider.signIn("nobody@example.com", "x")).rejects.toMatchObject({ code: "invalid-credentials" });
  });

  it("設定が揃っていれば_Cognito の実装を返す", () => {
    expect(getAuthProvider({ NODE_ENV: "production", COGNITO_CLIENT_ID: "c", AWS_REGION: "us-east-1" })).toBeDefined();
  });
});
