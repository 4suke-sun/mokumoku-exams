import type { Exam } from "../../../../scripts/lib/exam-data/schema.ts";

// データの型の正本は scripts/lib/exam-data/schema.ts(Zod)。型だけを参照し、実行時には読み込まない。
// データの形の検査は `npm run validate:data` が行う。
export type {
  Exam,
  ExamsFile,
  PublishedExam,
  Question,
  QuestionsFile,
} from "../../../../scripts/lib/exam-data/schema.ts";

export type ComingSoonExam = Extract<Exam, { status: "coming-soon" }>;
