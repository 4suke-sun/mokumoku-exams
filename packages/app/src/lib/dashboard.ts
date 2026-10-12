import { type GradableQuestion, isQuestionCorrect, passLinePercent, score } from "./quiz.ts";
import type { Result } from "./storage.ts";
import type { PublishedExam, Question } from "./types.ts";

/** 集計に使う、問題の情報(採点に要るものと、分野)。問題の本文や解説は要らない。 */
export type ScoredQuestion = GradableQuestion & { domain: string };

/** 問題から、集計に使う情報だけを取り出す(画面へ渡す量を減らす) */
export function toScored(question: Question): ScoredQuestion {
  return question.questionType === "free-text"
    ? {
        questionId: question.questionId,
        questionType: question.questionType,
        rubric: question.rubric,
        domain: question.domain,
      }
    : {
        questionId: question.questionId,
        questionType: question.questionType,
        correctAnswers: question.correctAnswers,
        domain: question.domain,
      };
}

/** 1 回分の結果の正答 */
export type AttemptSummary = { finishedAt: string; total: number; correct: number; percent: number };

/** 優先して復習したい分野の件数 */
export const PRIORITY_LIMIT = 3;

/** 合格予測の分野ごとの内訳 */
export type DomainPrediction = {
  domain: string;
  /** 配点の重み(資格マスタの値) */
  weight: number;
  answered: number;
  /** 分野の正答率(%)。出題がない分野は、全体の正答率で代用した値 */
  percent: number;
  /** 出題がなく、全体の正答率で代用したか */
  substituted: boolean;
  /** 合格ラインより下か */
  belowLine: boolean;
  /** 分野の平均回答時間(ミリ秒)。回答時間の記録がなければ null */
  avgTimeMs: number | null;
  /** 取りこぼしている配点(%) = 重み × (100 − 正答率)。復習の優先度の大きさ */
  loss: number;
};

/** 合格予測。直近の結果を分野ごとに集計し、資格マスタの重み(配点)で重み付けして、合格ラインと比べる。 */
export type Prediction = {
  /** 予測の正答率(%、小数第 1 位まで) */
  percent: number;
  /** 合格ライン(%) */
  passLine: number;
  reached: boolean;
  /** 合格ラインまでの差(ポイント)。届いているときは 0 */
  gap: number;
  /** 予測に使った結果の数 */
  basedOn: number;
  /** 分野ごとの内訳(資格マスタの分野の並び) */
  domains: DomainPrediction[];
  /** 優先して復習したい分野(取りこぼしの大きい順、`PRIORITY_LIMIT` 件まで) */
  priorities: DomainPrediction[];
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

/** 資格マスタの分野の重み */
export type DomainWeight = { code: string; weight: number };

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 合格予測に使う、直近の結果の回数 */
export const PREDICTION_WINDOW = 10;

/**
 * 保存した結果(新しい順)から、学習の状況をまとめる。
 * いまのデータにない問題は数えない。数えられる問題が 1 問もない結果は、解いた回数にも入れない。
 */
export function summarize(
  results: readonly Result[],
  questions: readonly ScoredQuestion[],
  exam: Pick<PublishedExam, "passingScore" | "totalScore"> & { domains?: readonly DomainWeight[] },
): DashboardSummary {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const seen = new Set<string>();
  const recent: AttemptSummary[] = [];
  const counted: { result: Result; asked: ScoredQuestion[] }[] = [];
  for (const result of results) {
    const asked = result.questionIds.map((id) => byId.get(id)).filter((q): q is ScoredQuestion => q !== undefined);
    if (asked.length === 0) continue;
    for (const q of asked) seen.add(q.questionId);
    const { total, correct, percent } = score(asked, result.answers, result.textAnswers);
    recent.push({ finishedAt: result.finishedAt, total, correct, percent });
    counted.push({ result, asked });
  }
  const answered = recent.reduce((sum, r) => sum + r.total, 0);
  const correct = recent.reduce((sum, r) => sum + r.correct, 0);
  const passLine = passLinePercent(exam);
  // 合格予測は、直近の `PREDICTION_WINDOW` 回だけで見る(古い結果が、今の力の見積もりを引きずらないように)
  const window = counted.slice(0, PREDICTION_WINDOW);
  return {
    attempts: recent.length,
    answered,
    correct,
    percent: answered === 0 ? 0 : round1((correct / answered) * 100),
    distinct: seen.size,
    totalQuestions: questions.length,
    recent,
    prediction: window.length === 0 ? null : predict(window, exam.domains ?? [], passLine),
  };
}

type Tally = { answered: number; correct: number; timeMs: number; timed: number };

const emptyTally = (): Tally => ({ answered: 0, correct: 0, timeMs: 0, timed: 0 });

/** 結果の問題を、分野ごとに数える。回答時間は、記録のある問題だけ足す。 */
function tallyByDomain(entries: readonly { result: Result; asked: readonly ScoredQuestion[] }[]): Map<string, Tally> {
  const tally = new Map<string, Tally>();
  for (const { result, asked } of entries) {
    for (const question of asked) {
      const own = tally.get(question.domain) ?? emptyTally();
      own.answered++;
      if (isQuestionCorrect(question, result.answers, result.textAnswers)) own.correct++;
      const at = result.questionIds.indexOf(question.questionId);
      const time = result.timesMs?.[at];
      if (time !== undefined) {
        own.timeMs += time;
        own.timed++;
      }
      tally.set(question.domain, own);
    }
  }
  return tally;
}

/**
 * 分野ごとの正答率を、資格マスタの重みで重み付けして平均する。出題がない分野は、全体の正答率で代用する。
 * 重みの合計が 1 でなくても、合計で割って正規化する。重みがないとき(合計 0)は、全体の正答率にする。
 */
function predict(
  window: readonly { result: Result; asked: readonly ScoredQuestion[] }[],
  domains: readonly DomainWeight[],
  passLine: number,
): Prediction {
  const tally = tallyByDomain(window);
  let answered = 0;
  let correct = 0;
  for (const t of tally.values()) {
    answered += t.answered;
    correct += t.correct;
  }
  const overall = answered === 0 ? 0 : (correct / answered) * 100;
  const weightSum = domains.reduce((sum, d) => sum + d.weight, 0);
  const rates = domains.map(({ code }) => {
    const own = tally.get(code);
    return own && own.answered > 0 ? (own.correct / own.answered) * 100 : null;
  });
  const rows: DomainPrediction[] = domains.map(({ code, weight }, i) => {
    const own = tally.get(code);
    const rate = rates[i] ?? overall;
    return {
      domain: code,
      weight,
      answered: own?.answered ?? 0,
      percent: round1(rate),
      substituted: rates[i] === null,
      belowLine: rate < passLine,
      avgTimeMs: own && own.timed > 0 ? Math.round(own.timeMs / own.timed) : null,
      loss: round1(weight * (100 - rate)),
    };
  });
  const weighted =
    weightSum <= 0 ? overall : domains.reduce((sum, d, i) => sum + d.weight * (rates[i] ?? overall), 0) / weightSum;
  const percent = round1(weighted);
  const reached = percent >= passLine;
  const priorities = rows
    .filter((row) => row.loss > 0)
    .sort((a, b) => b.loss - a.loss || a.percent - b.percent || (a.domain < b.domain ? -1 : 1))
    .slice(0, PRIORITY_LIMIT);
  return {
    percent,
    passLine,
    reached,
    gap: reached ? 0 : round1(passLine - percent),
    basedOn: window.length,
    domains: rows,
    priorities,
  };
}

/** 1 回の結果の、分野ごとの正答と平均回答時間(ミリ秒。記録がなければ null)。資格マスタの分野の並びで返す。 */
export type AttemptDomain = {
  domain: string;
  answered: number;
  correct: number;
  percent: number;
  avgTimeMs: number | null;
};

export function attemptDomains(
  result: Result,
  questions: readonly ScoredQuestion[],
  domains: readonly { code: string }[],
): AttemptDomain[] {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const asked = result.questionIds.flatMap((id) => byId.get(id) ?? []);
  const tally = tallyByDomain([{ result, asked }]);
  return domains.flatMap(({ code }) => {
    const own = tally.get(code);
    if (!own) return [];
    return [
      {
        domain: code,
        answered: own.answered,
        correct: own.correct,
        percent: round1((own.correct / own.answered) * 100),
        avgTimeMs: own.timed > 0 ? Math.round(own.timeMs / own.timed) : null,
      },
    ];
  });
}

/** 1 回の結果の、1 問あたりの平均回答時間(ミリ秒)。回答時間のない結果は null。 */
export function averageTimeMs(result: Pick<Result, "timesMs">): number | null {
  const times = result.timesMs ?? [];
  return times.length === 0 ? null : Math.round(times.reduce((sum, t) => sum + t, 0) / times.length);
}

/** 分野ごとの正答 */
export type DomainStat = { domain: string; answered: number; correct: number; percent: number };

/**
 * 保存した結果から、分野ごとの正答率を出し、低い順に並べる(弱い分野が先)。正答率が同じなら、解いた数の多い順、分野コードの順。
 * いまのデータにない問題は数えない。1 問も解いていない分野は含めない。未回答は不正解として数える。
 */
export function domainBreakdown(results: readonly Result[], questions: readonly ScoredQuestion[]): DomainStat[] {
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
