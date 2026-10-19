import { shuffle } from "./quiz.ts";
import type { Question } from "./types.ts";
import { fewerAnsweredWeight, weightedSample } from "./weighted.ts";

// モード選択の、出題の対象の絞り込みと、出題の選び方。画面から切り離した純粋な関数にして、単体テストする。

type Difficulty = NonNullable<Question["difficulty"]>;

/** 出題の対象。復習プールとブックマークは、アカウントに保存したもの。 */
export type Target = "all" | "review" | "bookmarks";

/** 選ぶと、出題の設定が出るモード */
export type SettingsMode = "normal" | "review" | "free-text";

export type PickItem = {
  questionId: string;
  domain: string;
  questionType: Question["questionType"];
  difficulty?: Difficulty;
};

/** 復習のモードは復習プール、自由記述のモードは全問が対象。通常出題だけが、対象を選べる */
export function activeTargetOf(mode: SettingsMode | null, target: Target): Target {
  return mode === "review" ? "review" : mode === "free-text" ? "all" : target;
}

export type TargetLists = { review: readonly string[] | null; bookmarks: readonly string[] | null };

/**
 * 対象で絞る。自由記述のモードは、自由記述の問題だけから出題する。復習のモードは、種類で絞らない。
 * 通常出題(モードを選ぶ前の `null` を含む)は、`includeFreeText` のときだけ自由記述の問題を含める(既定は選択式だけ)。
 * 対象の一覧(復習プール・ブックマーク)にあっても、いまのデータにない問題 ID は、ここで落ちる。
 */
export function inTarget<P extends PickItem>(
  pool: readonly P[],
  mode: SettingsMode | null,
  target: Target,
  lists: TargetLists,
  includeFreeText = false,
): P[] {
  const base =
    mode === "free-text"
      ? pool.filter((p) => p.questionType === "free-text")
      : mode === "review" || includeFreeText
        ? pool
        : pool.filter((p) => p.questionType !== "free-text");
  if (target === "all") return [...base];
  const ids = new Set(lists[target] ?? []);
  return base.filter((p) => ids.has(p.questionId));
}

/** モードで決まる対象で絞り、難易度で絞る。難易度を選んだときは、難易度のない問題を出さない。 */
export function targetQuestions<P extends PickItem>(
  pool: readonly P[],
  options: {
    mode: SettingsMode | null;
    target: Target;
    lists: TargetLists;
    difficulties: readonly Difficulty[];
    includeFreeText: boolean;
  },
): P[] {
  const { mode, target, lists, difficulties, includeFreeText } = options;
  return inTarget(pool, mode, activeTargetOf(mode, target), lists, includeFreeText).filter(
    (p) => difficulties.length === 0 || (p.difficulty !== undefined && difficulties.includes(p.difficulty)),
  );
}

/** 分野で絞る。分野を選んでいなければ、すべて */
export function inDomains<P extends PickItem>(questions: readonly P[], domains: readonly string[]): P[] {
  return domains.length === 0 ? [...questions] : questions.filter((p) => domains.includes(p.domain));
}

/**
 * 出題する問題を選ぶ。解答回数の少ない問題を優先するときは、重み 1/(1+回数)^2 で選ぶ(回数 0 の問題がいちばん出やすい)。
 * そうでなければ、混ぜて先頭から選ぶ。
 */
export function pickQuestions<P extends PickItem>(
  questions: readonly P[],
  options: { count: number; preferFewer: boolean; answerCounts: ReadonlyMap<string, number>; random: () => number },
): P[] {
  const { count, preferFewer, answerCounts, random } = options;
  return preferFewer
    ? weightedSample(questions, (p) => fewerAnsweredWeight(answerCounts.get(p.questionId) ?? 0), count, random)
    : shuffle(questions, random).slice(0, count);
}
