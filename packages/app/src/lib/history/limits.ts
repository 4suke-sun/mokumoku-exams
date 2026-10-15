/**
 * 履歴の API の件数の上限。ブラウザの部品(client.ts)とサーバー(repository.ts)の両方が読むので、
 * 保存先の実装を import しないこのファイルに置く。
 */

/** 結果の一覧で、1 回に返す件数 */
export const RESULTS_PAGE_SIZE = 50;
