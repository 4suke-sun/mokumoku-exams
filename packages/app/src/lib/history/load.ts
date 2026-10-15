import type { Result } from "@/lib/storage.ts";
import { browserStore, loadResults } from "@/lib/storage.ts";
import { fetchServerResultsPage } from "./client.ts";
import { mergeResults, pendingMigration } from "./merge.ts";

/**
 * 資格の結果を、サーバーを正として読み、この端末にだけ残っている記録も合わせる(結果の画面と同じ数え方)。
 * source の local は、サーバーに接続できず、この端末の記録だけで数えたとき。
 * next は、サーバーに続きがあるかもしれないときの、続きを取る位置(`fetchServerResultsPage` に渡す)。
 */
export async function loadExamResults(
  examCode: string,
): Promise<{ results: Result[]; source: "server" | "local"; next: string | null }> {
  const page = await fetchServerResultsPage(examCode);
  const local = loadResults(browserStore(), examCode);
  return page === null
    ? { results: local, source: "local", next: null }
    : {
        results: mergeResults(page.results, pendingMigration(local, page.results)),
        source: "server",
        next: page.next,
      };
}
