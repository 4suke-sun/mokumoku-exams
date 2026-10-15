import { MAX_RESULTS, type Result } from "@/lib/storage.ts";

/** この端末にだけある結果(サーバーに同じ完了時刻のものがない)。アカウントへの移行の対象。 */
export function pendingMigration(local: Result[], server: Result[]): Result[] {
  const known = new Set(server.map((r) => `${r.examCode}#${r.finishedAt}`));
  return local.filter((r) => !known.has(`${r.examCode}#${r.finishedAt}`));
}

/** サーバーの結果と、移行前の端末の結果を、新しい順にまとめる。 */
export function mergeResults(server: Result[], pending: Result[]): Result[] {
  return [...server, ...pending]
    .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0))
    .slice(0, MAX_RESULTS);
}

/** 一覧の続きを、いまの一覧の下に足す。すでにある完了時刻の結果は足さない(新しい順のまま)。 */
export function appendResults(current: readonly Result[], more: readonly Result[]): Result[] {
  const known = new Set(current.map((r) => r.finishedAt));
  return [...current, ...more.filter((r) => !known.has(r.finishedAt))];
}
