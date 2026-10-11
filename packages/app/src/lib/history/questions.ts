import { findPublishedExam, loadQuestions } from "@/lib/exam-data.ts";
import type { GradableQuestion } from "@/lib/quiz.ts";

/** 公開中の資格の、採点に使う問題の正解と採点基準。公開中でない資格は null。 */
export async function examQuestions(examCode: string): Promise<readonly GradableQuestion[] | null> {
  const exam = findPublishedExam(examCode);
  return exam ? loadQuestions(exam) : null;
}
