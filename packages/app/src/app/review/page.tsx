import type { Metadata } from "next";
import { type ReviewExam, ReviewView } from "@/components/review-view.tsx";
import { listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "復習" };

/** 一覧に出す、問題文の抜き出しの長さ */
const EXCERPT_LENGTH = 60;

function excerptOf(text: string): string {
  // 記法の記号は抜き出しに出さない(本文は、出題の画面で読む)
  const plain = text.replace(/[*`#]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH)}…` : plain;
}

export default async function ReviewPage() {
  const exams: ReviewExam[] = await Promise.all(
    listPublishedExams().map(async (exam) => ({
      examCode: exam.examCode,
      name: exam.name,
      questions: (await loadQuestions(exam)).map((q) => ({
        questionId: q.questionId,
        excerpt: excerptOf(q.questionText),
        choiceKeys: q.questionType === "free-text" ? [] : q.choices.map((c) => c.key),
      })),
    })),
  );
  return <ReviewView exams={exams} />;
}
