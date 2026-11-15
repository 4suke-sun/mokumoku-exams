import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

// VAPID の秘密鍵の読み出し。秘密鍵は、環境変数ではなく、SSM Parameter Store の SecureString に置く
// (環境変数には、パラメーターの名前だけが入る。docs/app/infra.md の「VAPID の秘密鍵」)。
// Lambda にも載せるため、`@/` を使わない(endpoint.ts を参照)。

/** 環境変数から読む、VAPID の公開鍵、秘密鍵のパラメーターの名前、連絡先。 */
export type VapidSettings = { publicKey: string; privateKeyParameter: string; subject: string };

/** パラメーターの値を読む(テストで差し替える)。値がなければ undefined。 */
export type ParameterReader = (name: string) => Promise<string | undefined>;

/** 秘密鍵を読めない。値も原因も持たない(ログや応答に出さないため)。 */
export class VapidKeyUnavailableError extends Error {
  constructor() {
    super("VAPID の秘密鍵を読めません。");
    this.name = "VapidKeyUnavailableError";
  }
}

/** 環境変数から VAPID の設定を読む。3 つそろっていなければ null(通知を送らない)。 */
export function readVapid(env: Record<string, string | undefined>): VapidSettings | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY_PARAMETER: privateKeyParameter, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKeyParameter || !subject) return null;
  return { publicKey, privateKeyParameter, subject };
}

let ssmClient: SSMClient | undefined;

/** SSM から、復号した値を読む。リージョンは、Lambda の既定(AWS_REGION)を使う。 */
export const readSsmParameter: ParameterReader = async (name) => {
  ssmClient ??= new SSMClient({});
  const output = await ssmClient.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  return output.Parameter?.Value;
};

/**
 * 秘密鍵を読む関数を作る。名前ごとに 1 度だけ読み、プロセスの中で覚えておく(同時に呼ばれても、読むのは 1 回)。
 * 読めないとき(値がない・空も含む)は、値と原因を捨てて `unavailable` の例外(既定は `VapidKeyUnavailableError`)にし、
 * 次に呼ばれたときに読み直す。
 */
export function createPrivateKeyLoader(
  read: ParameterReader,
  unavailable: () => Error = () => new VapidKeyUnavailableError(),
): (name: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (name) => {
    const cached = cache.get(name);
    if (cached) return cached;
    const loading = read(name).then(
      (value) => {
        if (!value) throw unavailable();
        return value;
      },
      () => {
        throw unavailable();
      },
    );
    cache.set(name, loading);
    loading.catch(() => cache.delete(name));
    return loading;
  };
}

/** プロセスで共有する、秘密鍵の読み出し。 */
export const loadVapidPrivateKey = createPrivateKeyLoader(readSsmParameter);
