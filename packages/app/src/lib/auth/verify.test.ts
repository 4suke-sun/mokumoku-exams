import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCognitoVerifier } from "./verify.ts";

const region = "us-east-1";
const poolId = "us-east-1_Example";
const clientId = "client-example";
const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

const b64 = (text: string) => Buffer.from(text).toString("base64url");
const part = (value: unknown) => b64(JSON.stringify(value));

function newKey(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" };
  return { privateKey, jwk };
}

type Key = ReturnType<typeof newKey>;

function makeToken(key: Key, kid: string, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const payload = {
    sub: "user-a",
    iss: issuer,
    aud: clientId,
    token_use: "id",
    exp: Math.floor(NOW / 1000) + 3600,
    email: "learner@example.com",
    ...claims,
  };
  const signed = `${part({ alg: "RS256", kid, ...header })}.${part(payload)}`;
  return `${signed}.${sign("RSA-SHA256", Buffer.from(signed), key.privateKey).toString("base64url")}`;
}

const primary = newKey("k1");
const other = newKey("k2");

function verifierWith(keys: Key[], now = () => NOW) {
  const fetchJwks = vi.fn(async () => ({ keys: keys.map((k) => k.jwk) }));
  return { fetchJwks, verifier: createCognitoVerifier({ region, userPoolId: poolId, clientId, now, fetchJwks }) };
}

describe("ID トークンの検証", () => {
  it("正しいトークン_利用者の sub とメールを返す", async () => {
    const { verifier } = verifierWith([primary]);
    expect(await verifier.verifyIdToken(makeToken(primary, "k1"))).toEqual({
      sub: "user-a",
      email: "learner@example.com",
    });
  });

  it("本文を書き換えたトークン_署名が合わず拒否する", async () => {
    const { verifier } = verifierWith([primary]);
    const [header, , signature] = makeToken(primary, "k1").split(".");
    const forged = `${header}.${part({ sub: "user-b", iss: issuer, aud: clientId, token_use: "id", exp: 9999999999 })}.${signature}`;
    expect(await verifier.verifyIdToken(forged)).toBeNull();
  });

  it("別の鍵で署名したトークン_鍵の識別子が同じでも拒否する", async () => {
    const { verifier } = verifierWith([primary]);
    expect(await verifier.verifyIdToken(makeToken(other, "k1"))).toBeNull();
  });

  it("署名なし(alg が none)のトークン_拒否する", async () => {
    const { verifier } = verifierWith([primary]);
    const unsigned = `${part({ alg: "none", kid: "k1" })}.${part({ sub: "user-a", iss: issuer, aud: clientId, token_use: "id", exp: 9999999999 })}.`;
    expect(await verifier.verifyIdToken(unsigned)).toBeNull();
  });

  it("alg が RS256 以外のトークン_拒否する", async () => {
    const { verifier } = verifierWith([primary]);
    expect(await verifier.verifyIdToken(makeToken(primary, "k1", {}, { alg: "HS256" }))).toBeNull();
  });

  it.each([
    ["発行元が違う", { iss: "https://cognito-idp.us-east-1.amazonaws.com/other-pool" }],
    ["クライアントが違う", { aud: "client-other" }],
    ["用途がアクセストークン", { token_use: "access" }],
    ["期限切れ", { exp: Math.floor(NOW / 1000) - 1 }],
    ["期限がちょうど今", { exp: Math.floor(NOW / 1000) }],
    ["期限が数値でない", { exp: "9999999999" }],
    ["sub がない", { sub: undefined }],
    ["sub に区切り文字がある", { sub: "user#a" }],
    ["sub が長すぎる", { sub: "a".repeat(129) }],
  ])("%s_拒否する", async (_name, claims) => {
    const { verifier } = verifierWith([primary]);
    expect(await verifier.verifyIdToken(makeToken(primary, "k1", claims))).toBeNull();
  });

  it.each([
    ["空", ""],
    ["区切りが足りない", "a.b"],
    // トークンの形の文字列は、そのまま書かず、実行時に組み立てる
    ["本文が JSON でない", [b64("{}"), b64("not-json"), b64("sig")].join(".")],
    ["長すぎる", `${"a".repeat(9000)}.b.c`],
  ])("壊れたトークン(%s)_拒否する", async (_name, token) => {
    const { verifier } = verifierWith([primary]);
    expect(await verifier.verifyIdToken(token)).toBeNull();
  });
});

describe("公開鍵の取得", () => {
  it("公開鍵は一度取得したら_期限内は取り直さない", async () => {
    const { verifier, fetchJwks } = verifierWith([primary]);
    await verifier.verifyIdToken(makeToken(primary, "k1"));
    await verifier.verifyIdToken(makeToken(primary, "k1"));
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    expect(fetchJwks).toHaveBeenCalledWith(`${issuer}/.well-known/jwks.json`);
  });

  it("取得できない_拒否する(通す側には倒さない)", async () => {
    const verifier = createCognitoVerifier({
      region,
      userPoolId: poolId,
      clientId,
      now: () => NOW,
      fetchJwks: async () => {
        throw new Error("unavailable");
      },
    });
    expect(await verifier.verifyIdToken(makeToken(primary, "k1"))).toBeNull();
  });

  it("鍵が入れ替わった_間隔を空けた後の未知の鍵の識別子で取り直して受け付ける", async () => {
    let time = NOW;
    let current = [primary];
    const fetchJwks = vi.fn(async () => ({ keys: current.map((k) => k.jwk) }));
    const verifier = createCognitoVerifier({ region, userPoolId: poolId, clientId, now: () => time, fetchJwks });
    expect(await verifier.verifyIdToken(makeToken(primary, "k1"))).not.toBeNull();

    current = [primary, other];
    time += 61_000;
    expect(await verifier.verifyIdToken(makeToken(other, "k2", { exp: Math.floor(time / 1000) + 60 }))).not.toBeNull();
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("未知の鍵の識別子が続く_取得は一定の間隔より頻繁に行わない", async () => {
    const { verifier, fetchJwks } = verifierWith([primary]);
    for (let i = 0; i < 5; i++) await verifier.verifyIdToken(makeToken(other, "unknown"));
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });

  it("RSA 以外や鍵の識別子のない鍵が混じる_無視して残りを使う", async () => {
    const verifier = createCognitoVerifier({
      region,
      userPoolId: poolId,
      clientId,
      now: () => NOW,
      fetchJwks: async () => ({ keys: [{ kid: "x", kty: "EC" }, { kid: "y", kty: "RSA" }, primary.jwk] }),
    });
    expect(await verifier.verifyIdToken(makeToken(primary, "k1"))).not.toBeNull();
  });
});
