import { guardDeps } from "@/lib/auth/deps.ts";
import { findPublishedExam, loadQuestions } from "@/lib/exam-data.ts";
import type { QuestionsDeps } from "./handlers.ts";

export function questionsDeps(): QuestionsDeps {
  return {
    auth: guardDeps(),
    questions: async (examCode) => {
      const exam = findPublishedExam(examCode);
      return exam ? loadQuestions(exam) : null;
    },
  };
}
