import { timingSafeEqual } from "node:crypto";

/** CloudFront がオリジンへ付ける合言葉のヘッダー名(packages/infra/lib/web-stack.ts と同じ。両方のテストで値を固定している) */
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";

/**
 * リクエストが、CloudFront 経由のものかを確かめる。Lambda の Function URL は認証なしで公開されるため、
 * 合言葉のないリクエスト(URL への直接のアクセス)を断る。
 * 合言葉が設定されていないときは、手元の開発(`production` でない)だけ、確かめずに通す。
 * 本番で設定が漏れても、検査が外れたままにならないよう、すべて断る。
 */
export function isOriginVerified(expected: string | undefined, actual: string | null, production: boolean): boolean {
  if (!expected) return !production;
  if (actual === null) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
