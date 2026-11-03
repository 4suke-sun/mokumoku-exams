import type { Metadata } from "next";
import Link from "next/link";
import { loadCodeDrill } from "@/lib/code-drill-data.ts";
import { listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";
import { loadNotebook } from "@/lib/notebook-data.ts";

export const metadata: Metadata = { title: "全問のプレビュー" };

/** 資格の一覧。管理者だけが開ける(`/admin` 以下は、入口とレイアウトの両方で管理者を確かめる)。 */
export default async function AdminPreviewIndexPage() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({
      exam,
      count: (await loadQuestions(exam)).length,
      notebook: await loadNotebook(exam),
      codeDrill: await loadCodeDrill(exam),
    })),
  );
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm text-primary hover:underline">
          管理へ戻る
        </Link>
        <h1 className="h1">全問のプレビュー</h1>
        <p className="text-sm text-muted">資格を選ぶと、全問の正解・解説・出典を一覧できます。</p>
      </div>
      <ul className="space-y-2">
        {exams.map(({ exam, count, notebook, codeDrill }) => (
          <li key={exam.examCode} className="space-y-1">
            <Link href={`/admin/preview/${exam.examCode}`} className="card block p-4">
              <span className="block font-bold text-primary">{exam.name}</span>
              <span className="block text-sm text-muted">
                {exam.examCode} / 問題 {count} 問
              </span>
            </Link>
            {notebook ? (
              <Link
                href={`/admin/preview/${exam.examCode}/notebook`}
                className="inline-block px-4 text-sm text-primary underline"
              >
                体系ノートのプレビュー(見出し {notebook.entries.length} 件。未検証を含む)
              </Link>
            ) : null}
            {codeDrill ? (
              <Link
                href={`/admin/preview/${exam.examCode}/code-drill`}
                className="inline-block px-4 text-sm text-primary underline"
              >
                コードドリルのプレビュー({codeDrill.length} 問。未検証を含む)
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
