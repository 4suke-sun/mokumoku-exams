import { createHash } from "node:crypto";

// このディレクトリ(lib/push)は、毎日の送信の Lambda にも載せる(scripts/lib/push-asset.ts)。
// そのため、ここのファイルは `@/` を使わず、同じディレクトリの中だけを相対で読み込む。

/** 購読のソートキーの接頭辞。`SK=PUSH#{endpoint のハッシュ}` */
export const PUSH_KEY_PREFIX = "PUSH#";

/** 購読のソートキー。endpoint は長く、利用者ごとの識別子を含むため、そのままではなくハッシュ(SHA-256)をキーにする。 */
export function pushKey(endpoint: string): string {
  return `${PUSH_KEY_PREFIX}${createHash("sha256").update(endpoint).digest("hex")}`;
}

/** endpoint の長さの上限 */
export const MAX_ENDPOINT_LENGTH = 2048;

/** 送信先として受け付けるプッシュサービス(主なブラウザのもの)。完全一致のホストと、ホストの末尾。 */
const PUSH_SERVICE_HOSTS = ["fcm.googleapis.com"];
const PUSH_SERVICE_HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

/**
 * ブラウザのプッシュサービスの endpoint か。サーバーは endpoint へリクエストを送るので、任意の URL
 * (内部のアドレスなど)へ送らないよう、https で、既知のプッシュサービスのホストのものだけを受け付ける。
 */
export function isPushServiceEndpoint(endpoint: string): boolean {
  if (endpoint.length > MAX_ENDPOINT_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname;
  return PUSH_SERVICE_HOSTS.includes(host) || PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
