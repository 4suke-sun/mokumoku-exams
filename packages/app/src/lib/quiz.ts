import type { PublishedExam, Question } from "./types.ts";

type Choice = Question["choices"][number];

/** 問題 ID ごとの、選んだ選択肢のキー */
export type Answers = Record<string, string[]>;

export type Score = { total: number; correct: number; percent: number };

/** 問題 ID に対する回答を返す。回答がなければ空。継承されたプロパティ(`constructor` など)は回答として扱わない。 */
export function answerFor(answers: Answers, questionId: string): readonly string[] {
  return Object.hasOwn(answers, questionId) ? (answers[questionId] ?? []) : [];
}

/** 選んだ選択肢が、正解の集合と一致するか。順序は問わない。 */
export function isCorrect(question: Pick<Question, "correctAnswers">, selected: readonly string[]): boolean {
  const chosen = new Set(selected);
  return chosen.size === question.correctAnswers.length && question.correctAnswers.every((key) => chosen.has(key));
}

/** Fisher-Yates。`random` は 0 以上 1 未満の値を返す関数(テストで固定できるように外から渡す)。 */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}

export type PickOptions = {
  /** 出題数。出題できる問題より多いときは、出題できる問題の数に切り詰める。 */
  count: number;
  /** 出題する分野のコード。空のときは、すべての分野。 */
  domains: readonly string[];
};

/** 条件に合う問題から、ランダムに `count` 問を選ぶ。 */
export function pickQuestions(all: readonly Question[], options: PickOptions, random: () => number): Question[] {
  const pool = options.domains.length === 0 ? all : all.filter((q) => options.domains.includes(q.domain));
  const count = Math.max(0, Math.min(options.count, pool.length));
  return shuffle(pool, random).slice(0, count);
}

/** 出題できる問題の数 */
export function countPool(all: readonly Question[], domains: readonly string[]): number {
  return domains.length === 0 ? all.length : all.filter((q) => domains.includes(q.domain)).length;
}

/** 正答数 ÷ 出題数 × 100(%)。未回答は不正解として数える。 */
export function score(questions: readonly Question[], answers: Answers): Score {
  const total = questions.length;
  const correct = questions.filter((q) => isCorrect(q, answerFor(answers, q.questionId))).length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
  return { total, correct, percent };
}

/** 合格ライン(%)。合格点を満点で割った割合。 */
export function passLinePercent(exam: Pick<PublishedExam, "passingScore" | "totalScore">): number {
  return Math.round((exam.passingScore / exam.totalScore) * 1000) / 10;
}

/** 選択肢のキーを、表示用の並び(A, B, …)にそろえる。 */
export function sortKeys(keys: readonly string[]): string[] {
  return [...keys].sort();
}

/** 問題 ID ごとの、選択肢のキーの並び */
export type ChoiceOrder = Record<string, string[]>;

/** 各問題の選択肢の並びをシャッフルして決める。 */
export function shuffleChoiceOrder(
  items: readonly { questionId: string; choiceKeys: readonly string[] }[],
  random: () => number,
): ChoiceOrder {
  const order: ChoiceOrder = {};
  for (const item of items) order[item.questionId] = shuffle(item.choiceKeys, random);
  return order;
}

/**
 * 保存された並びで選択肢を返す。並びがない、または選択肢のキーと食い違うときは、元の並び。
 * 食い違いは、データが更新されたあとの古い保存を想定している。
 */
export function orderChoices(question: Pick<Question, "questionId" | "choices">, order?: ChoiceOrder): Choice[] {
  const keys = order && Object.hasOwn(order, question.questionId) ? order[question.questionId] : undefined;
  if (!keys || keys.length !== question.choices.length) return question.choices;
  const byKey = new Map(question.choices.map((c) => [c.key, c]));
  const ordered = keys.map((k) => byKey.get(k));
  const valid = new Set(keys).size === keys.length && ordered.every((c) => c !== undefined);
  return valid ? (ordered as Choice[]) : question.choices;
}

/** 回答済みの問題数と、出題数 */
export function sessionProgress(session: { questionIds: readonly string[]; answers: Answers }): {
  answered: number;
  total: number;
} {
  const answered = session.questionIds.filter((id) => answerFor(session.answers, id).length > 0).length;
  return { answered, total: session.questionIds.length };
}

/** 分野ごとの出題できる問題数 */
export function domainCounts(pool: readonly { domain: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pool) counts[p.domain] = (counts[p.domain] ?? 0) + 1;
  return counts;
}
