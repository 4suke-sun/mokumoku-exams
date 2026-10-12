import { isQuestionCorrect, passLinePercent, score } from "./quiz.ts";
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

/** 合格予測に使う、直近の結果の回数 */
export const PREDICTION_WINDOW = 10;

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
    const { total, correct, percent } = score(asked, result.answers, result.textAnswers);
    recent.push({ finishedAt: result.finishedAt, total, correct, percent });
  }
  const answered = recent.reduce((sum, r) => sum + r.total, 0);
  const correct = recent.reduce((sum, r) => sum + r.correct, 0);
  const passLine = passLinePercent(exam);
  // 合格予測は、直近の `PREDICTION_WINDOW` 回だけで見る(古い結果が、今の力の見積もりを引きずらないように)
  const window = recent.slice(0, PREDICTION_WINDOW);
  const averagePercent =
    window.length === 0 ? 0 : round1(window.reduce((sum, r) => sum + r.percent, 0) / window.length);
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
        : { averagePercent, passLine, reached: averagePercent >= passLine, basedOn: window.length },
  };
}

/** 分野ごとの正答 */
export type DomainStat = { domain: string; answered: number; correct: number; percent: number };

/**
 * 保存した結果から、分野ごとの正答率を出し、低い順に並べる(弱い分野が先)。正答率が同じなら、解いた数の多い順、分野コードの順。
 * いまのデータにない問題は数えない。1 問も解いていない分野は含めない。未回答は不正解として数える。
 */
export function domainBreakdown(results: readonly Result[], questions: readonly Question[]): DomainStat[] {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const tally = new Map<string, { answered: number; correct: number }>();
  for (const result of results) {
    for (const id of result.questionIds) {
      const question = byId.get(id);
      if (!question) continue;
      const own = tally.get(question.domain) ?? { answered: 0, correct: 0 };
      own.answered++;
      if (isQuestionCorrect(question, result.answers, result.textAnswers)) own.correct++;
      tally.set(question.domain, own);
    }
  }
  return [...tally.entries()]
    .map(([domain, { answered, correct }]) => ({
      domain,
      answered,
      correct,
      percent: round1((correct / answered) * 100),
    }))
    .sort((a, b) => a.percent - b.percent || b.answered - a.answered || (a.domain < b.domain ? -1 : 1));
}
