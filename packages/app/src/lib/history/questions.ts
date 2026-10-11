import { findPublishedExam, loadQuestions } from "@/lib/exam-data.ts";
import type { Question } from "@/lib/types.ts";

/** 公開中の資格の、採点に使う問題の正解。公開中でない資格は null。 */
export async function examQuestions(
  examCode: string,
): Promise<readonly Pick<Question, "questionId" | "correctAnswers">[] | null> {
  const exam = findPublishedExam(examCode);
  return exam ? loadQuestions(exam) : null;
}
