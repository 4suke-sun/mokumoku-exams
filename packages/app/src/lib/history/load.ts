import type { Result } from "@/lib/storage.ts";
import { browserStore, loadResults } from "@/lib/storage.ts";
import { fetchServerResults } from "./client.ts";
import { mergeResults, pendingMigration } from "./merge.ts";

/**
 * 資格の結果を、サーバーを正として読み、この端末にだけ残っている記録も合わせる(結果の画面と同じ数え方)。
 * source の local は、サーバーに接続できず、この端末の記録だけで数えたとき。
 */
export async function loadExamResults(examCode: string): Promise<{ results: Result[]; source: "server" | "local" }> {
  const server = await fetchServerResults(examCode);
  const local = loadResults(browserStore(), examCode);
  return server === null
    ? { results: local, source: "local" }
    : { results: mergeResults(server, pendingMigration(local, server)), source: "server" };
}
