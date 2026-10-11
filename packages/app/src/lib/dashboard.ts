import { passLinePercent, score } from "./quiz.ts";
import type { Result } from "./storage.ts";
import type { PublishedExam, Question } from "./types.ts";

/** 1 回分の結果の正答 */
export type AttemptSummary = { finishedAt: string; total: number; correct: number; percent: number };

/** 合格予測。直近の結果の正答率の平均を、合格ラインと比べる。 */
export type Prediction = {
  /** 平均の正答率(%、小数第 1 位まで) */
  averagePercent: number;
  /** 合格ライン(%) */
  passLine: number;
  reached: boolean;
  /** 平均に使った結果の数 */
  basedOn: number;
};

export type DashboardSummary = {
  /** 解いた回数 */
  attempts: number;
  /** 解いた問題の延べ数と、そのうちの正解数 */
  answered: number;
  correct: number;
  /** 延べの正答率(%) */
  percent: number;
  /** 一度でも解いた問題の数と、資格の問題の総数 */
  distinct: number;
  totalQuestions: number;
  /** 新しい順 */
  recent: AttemptSummary[];
  prediction: Prediction | null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * 保存した結果(新しい順)から、学習の状況をまとめる。
 * いまのデータにない問題は数えない。数えられる問題が 1 問もない結果は、解いた回数にも入れない。
 */
export function summarize(
  results: readonly Result[],
  questions: readonly Question[],
  exam: Pick<PublishedExam, "passingScore" | "totalScore">,
): DashboardSummary {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const seen = new Set<string>();
  const recent: AttemptSummary[] = [];
  for (const result of results) {
    const asked = result.questionIds.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
    if (asked.length === 0) continue;
    for (const q of asked) seen.add(q.questionId);
    const { total, correct, percent } = score(asked, result.answers);
    recent.push({ finishedAt: result.finishedAt, total, correct, percent });
  }
  const answered = recent.reduce((sum, r) => sum + r.total, 0);
  const correct = recent.reduce((sum, r) => sum + r.correct, 0);
  const passLine = passLinePercent(exam);
  const averagePercent =
    recent.length === 0 ? 0 : round1(recent.reduce((sum, r) => sum + r.percent, 0) / recent.length);
  return {
    attempts: recent.length,
    answered,
    correct,
    percent: answered === 0 ? 0 : round1((correct / answered) * 100),
    distinct: seen.size,
    totalQuestions: questions.length,
    recent,
    prediction:
      recent.length === 0
        ? null
        : { averagePercent, passLine, reached: averagePercent >= passLine, basedOn: recent.length },
  };
}
