import { describe, expect, it } from "vitest";
import { FAKE_USER_PHRASE } from "./fake.ts";
import { getAuthProvider, getTokenVerifier } from "./index.ts";

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

describe("getTokenVerifier", () => {
  it("本番の設定では_AUTH_FAKE があっても代替を使わず_設定が足りなければ失敗する", () => {
    expect(() => getTokenVerifier({ NODE_ENV: "production", AUTH_FAKE: "1" })).toThrow();
  });

  it("手元の開発で AUTH_FAKE=1 のとき_署名のないトークンも代替の発行したものなら通す", async () => {
    const provider = getAuthProvider({ NODE_ENV: "development", AUTH_FAKE: "1" });
    const verifier = getTokenVerifier({ NODE_ENV: "development", AUTH_FAKE: "1" });
    const result = await provider.signIn("learner@example.com", FAKE_USER_PHRASE);
    if (result.kind !== "signed-in") throw new Error("unexpected");
    expect(await verifier.verifyIdToken(result.tokens.idToken)).toMatchObject({ email: "learner@example.com" });
  });

  it("設定が揃っている本番_署名のないトークンを拒否する", async () => {
    const verifier = getTokenVerifier({
      NODE_ENV: "production",
      COGNITO_CLIENT_ID: "c",
      COGNITO_USER_POOL_ID: "us-east-1_Example",
      AWS_REGION: "us-east-1",
    });
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from('{"sub":"a"}').toString("base64url")}.`;
    expect(await verifier.verifyIdToken(unsigned)).toBeNull();
  });
});
