import type { Metadata } from "next";
import { BackLink } from "@/components/back-link.tsx";
import { FeedbackForm } from "@/components/feedback-form.tsx";
import { Notice } from "@/components/notice.tsx";
import { findPublishedExam, loadQuestions } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "問題の誤りを報告" };

/** 問題文の冒頭として出す文字数 */
const EXCERPT_LENGTH = 80;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = [...flat];
  return chars.length > EXCERPT_LENGTH ? `${chars.slice(0, EXCERPT_LENGTH).join("")}…` : flat;
}

export default async function ReportQuestionPage({
  searchParams,
}: {
  searchParams: Promise<{ exam?: string | string[]; id?: string | string[] }>;
}) {
  const { exam: examCode, id: questionId } = await searchParams;
  const exam = typeof examCode === "string" ? findPublishedExam(examCode) : undefined;
  const question =
    exam && typeof questionId === "string"
      ? (await loadQuestions(exam)).find((q) => q.questionId === questionId)
      : undefined;

  return (
    <section className="space-y-6">
      <h1 className="h1">問題の誤りを報告</h1>
      {exam && question ? (
        <FeedbackForm form="question" examCode={exam.examCode} questionId={question.questionId} backLink={<BackLink />}>
          <dl className="card space-y-1 p-4 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">資格</dt>
              <dd>{exam.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">問題 ID</dt>
              <dd>{question.questionId}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="flex-none text-muted">問題文</dt>
              <dd>{excerpt(question.questionText)}</dd>
            </div>
          </dl>
        </FeedbackForm>
      ) : (
        <Notice kind="error">対象の問題が見つかりません。</Notice>
      )}
    </section>
  );
}
