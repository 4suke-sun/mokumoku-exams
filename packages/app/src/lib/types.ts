import type { Exam } from "@mokumoku-exams/data-schema/exam-data/schema";

// データの型の正本は packages/data-schema/src/exam-data/schema.ts(Zod)。型だけを参照し、実行時には読み込まない。
// データの形の検査は `npm run validate:data` が行う。
export type {
  ChoiceQuestion,
  Exam,
  ExamsFile,
  FreeTextQuestion,
  PublishedExam,
  Question,
  QuestionsFile,
  Reference,
  Rubric,
} from "@mokumoku-exams/data-schema/exam-data/schema";

export type ComingSoonExam = Extract<Exam, { status: "coming-soon" }>;
