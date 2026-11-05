import { findPublishedExam } from "@/lib/exam-data.ts";
import { loadNotebook, visibleEntries } from "@/lib/notebook-data.ts";

/**
 * 公開中の資格の体系ノートで、完了にできる節(利用者の画面に出す見出し、つまり検証済みの見出し)。
 * 見出しの ID から、その見出しが属する中分類の ID を引く。
 * 資格が公開中でないか、ノートのない資格は null。
 */
export async function examNotebookEntries(examCode: string): Promise<ReadonlyMap<string, string> | null> {
  const exam = findPublishedExam(examCode);
  const notebook = exam ? await loadNotebook(exam) : null;
  return notebook ? new Map(visibleEntries(notebook.entries, false).map((entry) => [entry.id, entry.unit])) : null;
}
