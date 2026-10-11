import { createCognitoProvider } from "./cognito.ts";
import { createFakeProvider, createFakeVerifier } from "./fake.ts";
import type { AuthProvider } from "./types.ts";
import { createCognitoVerifier, type TokenVerifier } from "./verify.ts";

// 手元の開発サーバーでは、画面の処理と API の処理が別々に読み込まれることがあるので、代替の状態は globalThis に置く
const shared = globalThis as typeof globalThis & { __mokumokuFakeAuth?: AuthProvider };
let fakeVerifier: TokenVerifier | undefined;
let cognitoVerifier: { key: string; verifier: TokenVerifier } | undefined;

const isFakeMode = (env: NodeJS.ProcessEnv) => env.NODE_ENV !== "production" && env.AUTH_FAKE === "1";

/**
 * 認証の実装を選ぶ。本番は Cognito。手元の開発だけ、`AUTH_FAKE=1` でメモリ上の代替に切り替えられる
 * (本番の設定では、この指定があっても使わない)。
 */
export function getAuthProvider(env: NodeJS.ProcessEnv = process.env): AuthProvider {
  if (isFakeMode(env)) {
    shared.__mokumokuFakeAuth ??= createFakeProvider();
    return shared.__mokumokuFakeAuth;
  }
  const clientId = env.COGNITO_CLIENT_ID;
  const region = env.AWS_REGION;
  if (!clientId || !region) throw new Error("認証の設定(COGNITO_CLIENT_ID / AWS_REGION)がありません。");
  return createCognitoProvider({ region, clientId });
}

/**
 * ID トークンの検証を選ぶ。本番は Cognito の公開鍵で署名を確かめる。手元の開発だけ、`AUTH_FAKE=1` で
 * 代替認証のトークンを受け付ける(本番の設定では、この指定があっても使わない)。
 */
export function getTokenVerifier(env: NodeJS.ProcessEnv = process.env): TokenVerifier {
  if (isFakeMode(env)) {
    fakeVerifier ??= createFakeVerifier();
    return fakeVerifier;
  }
  const { COGNITO_CLIENT_ID: clientId, COGNITO_USER_POOL_ID: userPoolId, AWS_REGION: region } = env;
  if (!clientId || !userPoolId || !region) {
    throw new Error("認証の設定(COGNITO_CLIENT_ID / COGNITO_USER_POOL_ID / AWS_REGION)がありません。");
  }
  const key = `${region}/${userPoolId}/${clientId}`;
  if (cognitoVerifier?.key !== key) {
    cognitoVerifier = { key, verifier: createCognitoVerifier({ region, userPoolId, clientId }) };
  }
  return cognitoVerifier.verifier;
}
