import type { NotebookCheck, NotebookCheckKey } from "@mokumoku-exams/data-schema/notebook-data/schema";
import type { NotebookEntry, TocDomain, TocUnit } from "./notebook-data.ts";
import { shuffle } from "./quiz.ts";

// 体系ノートの確認の問い(2 択)と、中分類の末尾のおさらい、履修済みの数え方。画面から切り離した純粋な関数。

export type { NotebookCheck, NotebookCheckKey };

/** おさらいの問い 1 つ。`id` は、ページの中で一意(見出しの ID と、見出しの中の問いの番号) */
export type ReviewItem = { id: string; term: string; check: NotebookCheck };

/** 中分類のおさらいの問い。渡した見出し(画面に出すもの)のうち、その中分類のものを、見出しの並び順 → 見出しの中の問いの順で並べる */
export function reviewItemsOf(entries: readonly NotebookEntry[], unitId: string): ReviewItem[] {
  return entries
    .filter((entry) => entry.unit === unitId)
    .flatMap((entry) => entry.checks.map((check, i) => ({ id: `${entry.id}-${i + 1}`, term: entry.term, check })));
}

/** 画面に出す選択肢の並び。`shuffled` のときは、A・B の並びを入れ替えることがある(半々) */
export function choiceOrderOf(shuffled: boolean, random: () => number): NotebookCheckKey[] {
  return shuffled ? shuffle(["A", "B"] as NotebookCheckKey[], random) : ["A", "B"];
}

/** おさらいの 1 回の通しの並び: 問いの並びと、問いごとの選択肢の並び。`shuffleItems` のときは、問いの並びも入れ替える */
export type ReviewArrangement = { items: ReviewItem[]; choiceOrder: Record<string, NotebookCheckKey[]> };

export function arrangeReview(
  items: readonly ReviewItem[],
  random: () => number,
  shuffleItems: boolean,
): ReviewArrangement {
  const ordered = shuffleItems ? shuffle(items, random) : [...items];
  const choiceOrder: Record<string, NotebookCheckKey[]> = {};
  for (const item of ordered) choiceOrder[item.id] = choiceOrderOf(true, random);
  return { items: ordered, choiceOrder };
}

/** おさらいの採点。全問に答えていて、すべて正解のときだけ `allCorrect` */
export function gradeReview(
  items: readonly ReviewItem[],
  answers: Readonly<Record<string, NotebookCheckKey | undefined>>,
): { correct: number; total: number; allCorrect: boolean } {
  const correct = items.filter((item) => answers[item.id] === item.check.correct).length;
  return { correct, total: items.length, allCorrect: items.length > 0 && correct === items.length };
}

/** 履修済みにできる中分類(画面に出す見出しのある中分類)。目次の並び */
export function completableUnits(toc: readonly TocDomain[]): TocUnit[] {
  return toc.flatMap((domain) => domain.units.filter((unit) => unit.count > 0));
}

/** 履修済みの数(分母は、画面に出す見出しのある中分類)。ノートにない中分類の記録は数えない */
export function completedCount(units: readonly TocUnit[], completed: ReadonlyMap<string, string>): number {
  return units.filter((unit) => completed.has(unit.id)).length;
}

/**
 * 「続きから」の指す先: 目次の順で最初の、履修済みでない中分類(見出しのない中分類は飛ばす)。
 * すべて履修済みなら `"all-done"`、履修済みにできる中分類がなければ null。
 */
export function continueUnit(
  toc: readonly TocDomain[],
  completed: ReadonlyMap<string, string>,
): TocUnit | "all-done" | null {
  const units = completableUnits(toc);
  if (units.length === 0) return null;
  return units.find((unit) => !completed.has(unit.id)) ?? "all-done";
}

/** 履修した日の表示(日本時間の `YYYY/M/D`)。読めない時刻は空文字 */
export function completedDateLabel(completedAt: string): string {
  const time = Date.parse(completedAt);
  if (Number.isNaN(time)) return "";
  const date = new Date(time + 9 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
