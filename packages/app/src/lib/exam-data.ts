import examsFile from "../../../../data/exams.json";
import type { Exam, ExamsFile, PublishedExam, Question, QuestionsFile } from "./types.ts";

// リポジトリ直下の data/ の静的な JSON を読む。形は `npm run validate:data` が検査している。
// サーバー側(ビルド時を含む)だけで使う。

/** 動作確認用の架空の資格のベンダー(`docs/data-spec.md` の「9. サンプルデータ」) */
const SAMPLE_VENDOR = "Example";

/**
 * 画面に出す資格。動作確認用の架空の資格は、本番のビルドでは出さず、開発・テスト・E2E でだけ出す。
 * `showSamples` を引数にして、本番と開発の両方の振る舞いを単体テストで確かめる。
 */
export function visibleExams(all: readonly Exam[], showSamples: boolean): Exam[] {
  return all.filter((exam) => showSamples || exam.vendor !== SAMPLE_VENDOR);
}

const exams = visibleExams((examsFile as ExamsFile).exams, process.env.NODE_ENV !== "production");

export function listExams(): readonly Exam[] {
  return exams;
}

export function listPublishedExams(): PublishedExam[] {
  return exams.filter((exam): exam is PublishedExam => exam.status === "published");
}

export function findPublishedExam(code: string): PublishedExam | undefined {
  return listPublishedExams().find((exam) => exam.examCode === code);
}

/** 公開中の資格の問題を読む。ファイル名は `questions.<資格コードの英小文字>.json`。 */
export async function loadQuestions(exam: PublishedExam): Promise<Question[]> {
  const file = (await import(`../../../../data/questions.${exam.examCode.toLowerCase()}.json`)) as {
    default: QuestionsFile;
  };
  return file.default.questions;
}
