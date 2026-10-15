/**
 * 問題データの正解の偏りの検査。問題を読まなくても、記号の位置や選択肢の長さを手がかりに正解を選べないかを数える。
 * 報告は、ファイルと種類と数だけにする(問題の本文は出さない)。規則は docs/data-spec.md の「4. 機械検査する規則」。
 */

/** 検査に使う、問題の項目だけ */
export type BiasQuestion = {
  questionType: string;
  choices?: readonly { key: string; text: string }[];
  correctAnswers?: readonly string[];
};

/** 種類ごとに、この数より少ないファイルは検査しない(分布がぶれるため) */
export const MIN_BIAS_QUESTIONS = 20;
/** 記号の偏りとみなす、期待値からのずれ(標準偏差の何倍か) */
export const BIAS_SIGMAS = 3;
/** 記号の偏りとみなす、期待値からのずれ(期待値に対する割合) */
export const BIAS_RATIO = 0.4;
/** 択一で、最長の選択肢が正解である問題の割合の上限(偏りがなければ、選択肢が 4 つで 25% 前後) */
export const LONGEST_CORRECT_MAX = 0.4;

const TYPE_NAMES: Record<string, string> = { single: "択一", multiple: "複数選択" };

export type LetterStat = { letter: string; observed: number; expected: number; sigma: number };

/**
 * 正解の記号ごとに、観測した数と、偏りがないときの期待値・標準偏差を数える。
 * 問題ごとに、正解の数 ÷ 選択肢の数 を、その問題の選択肢の記号それぞれが正解になる確率とみなす。
 */
export function letterStats(questions: readonly BiasQuestion[]): LetterStat[] {
  const stats = new Map<string, { observed: number; expected: number; variance: number }>();
  for (const q of questions) {
    const keys = q.choices?.map((c) => c.key) ?? [];
    const correct = new Set(q.correctAnswers ?? []);
    if (keys.length === 0) continue;
    const p = correct.size / keys.length;
    for (const key of keys) {
      const stat = stats.get(key) ?? { observed: 0, expected: 0, variance: 0 };
      stat.expected += p;
      stat.variance += p * (1 - p);
      if (correct.has(key)) stat.observed += 1;
      stats.set(key, stat);
    }
  }
  return [...stats]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, s]) => ({ letter, observed: s.observed, expected: s.expected, sigma: Math.sqrt(s.variance) }));
}

/** 偏りとみなすか: ずれが標準偏差の `BIAS_SIGMAS` 倍を超え、かつ期待値の `BIAS_RATIO` を超える */
export function isBiased(stat: LetterStat): boolean {
  const gap = Math.abs(stat.observed - stat.expected);
  return gap > BIAS_SIGMAS * stat.sigma && gap > BIAS_RATIO * stat.expected;
}

/**
 * 択一の問題で、選択肢の文字数が最大の選択肢がただ 1 つあり、それが正解である問題の数。
 * 最長が同じ文字数で並ぶ問題は、数えない。分母は択一の問題数。
 */
export function longestCorrect(questions: readonly BiasQuestion[]): { count: number; total: number } {
  const singles = questions.filter((q) => q.questionType === "single" && (q.correctAnswers?.length ?? 0) === 1);
  const count = singles.filter((q) => {
    const choices = q.choices ?? [];
    const max = Math.max(...choices.map((c) => [...c.text].length));
    const longest = choices.filter((c) => [...c.text].length === max);
    return longest.length === 1 && longest[0]?.key === q.correctAnswers?.[0];
  }).length;
  return { count, total: singles.length };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 1 つのファイルの問題の偏りを検査する。記号の偏りは失敗、最長の選択肢の偏りは警告にする。 */
export function checkAnswerBias(
  file: string,
  questions: readonly BiasQuestion[],
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const type of ["single", "multiple"]) {
    const ofType = questions.filter((q) => q.questionType === type);
    if (ofType.length < MIN_BIAS_QUESTIONS) continue;
    for (const stat of letterStats(ofType).filter(isBiased)) {
      const ratio = stat.expected === 0 ? 0 : stat.observed / stat.expected;
      errors.push(
        `${file}: ${TYPE_NAMES[type]}の正解の記号 ${stat.letter} が、偏りのないときの期待値から外れています` +
          `(${stat.observed} 問。期待値の ${ratio.toFixed(2)} 倍)`,
      );
    }
  }
  const { count, total } = longestCorrect(questions);
  if (total >= MIN_BIAS_QUESTIONS && count / total > LONGEST_CORRECT_MAX) {
    warnings.push(
      `${file}: 択一で、最長の選択肢が正解の問題が多すぎます(${count} / ${total} 問、${percent(count / total)}。上限 ${percent(LONGEST_CORRECT_MAX)})`,
    );
  }
  return { errors, warnings };
}
