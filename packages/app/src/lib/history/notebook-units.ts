import { findPublishedExam } from "@/lib/exam-data.ts";
import { loadNotebook, visibleEntries } from "@/lib/notebook-data.ts";

/**
 * 公開中の資格の体系ノートで、履修済みにできる中分類の ID(利用者の画面に出す見出し、つまり検証済みの見出しのある中分類)。
 * 資格が公開中でないか、ノートのない資格は null。
 */
export async function examNotebookUnits(examCode: string): Promise<ReadonlySet<string> | null> {
  const exam = findPublishedExam(examCode);
  const notebook = exam ? await loadNotebook(exam) : null;
  return notebook ? new Set(visibleEntries(notebook.entries, false).map((entry) => entry.unit)) : null;
}
