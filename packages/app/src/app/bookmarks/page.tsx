import type { Metadata } from "next";
import { BookmarkCheck } from "@/components/bookmark-check.tsx";
import { listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "直前チェック(ブックマーク)" };

export default async function BookmarksPage() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, order: (await loadQuestions(exam)).map((q) => q.questionId) })),
  );

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <h1 className="h1">直前チェック(ブックマーク)</h1>
        <p className="text-sm text-muted">ブックマークした問題を、正解と解説つきで見直します。</p>
      </div>
      {exams.map(({ exam, order }) => (
        <BookmarkCheck key={exam.examCode} exam={exam} order={order} />
      ))}
    </section>
  );
}
