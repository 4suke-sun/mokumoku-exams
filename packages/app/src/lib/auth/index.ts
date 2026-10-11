import { createCognitoProvider } from "./cognito.ts";
import { createFakeProvider } from "./fake.ts";
import type { AuthProvider } from "./types.ts";

let fake: AuthProvider | undefined;

/**
 * 認証の実装を選ぶ。本番は Cognito。手元の開発だけ、`AUTH_FAKE=1` でメモリ上の代替に切り替えられる
 * (本番の設定では、この指定があっても使わない)。
 */
export function getAuthProvider(env: NodeJS.ProcessEnv = process.env): AuthProvider {
  if (env.NODE_ENV !== "production" && env.AUTH_FAKE === "1") {
    fake ??= createFakeProvider();
    return fake;
  }
  const clientId = env.COGNITO_CLIENT_ID;
  const region = env.AWS_REGION;
  if (!clientId || !region) throw new Error("認証の設定(COGNITO_CLIENT_ID / AWS_REGION)がありません。");
  return createCognitoProvider({ region, clientId });
}
