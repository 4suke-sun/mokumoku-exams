import type { NotebookCheck, NotebookCheckKey } from "@mokumoku-exams/data-schema/notebook-data/schema";
import type { NotebookEntry, TocDomain, TocEntry, TocUnit } from "./notebook-data.ts";
import { shuffle } from "./quiz.ts";

// 体系ノートの確認の問い(2 択)と、中分類の末尾のおさらい、節の完了と履修済みの数え方。画面から切り離した純粋な関数。

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

/** アカウントから読んだ記録。`units` は旧い中分類の履修済み(中分類の ID から時刻)、`entries` は完了した節(`<中分類の ID>#<見出しの ID>` から時刻) */
export type NotebookRecords = { units: ReadonlyMap<string, string>; entries: ReadonlyMap<string, string> };

/** 節(見出し)を持つ中分類。目次の中分類(`TocUnit`)がそのまま当てはまる */
export type SectionUnit = { id: string; entries: readonly { id: string }[] };

export function sectionKey(unit: string, entry: string): string {
  return `${unit}#${entry}`;
}

/** 節の完了の記録を持つか(旧い中分類の記録は含めない) */
export function hasEntryRecord(records: NotebookRecords, unit: string, entry: string): boolean {
  return records.entries.has(sectionKey(unit, entry));
}

/** 節が完了しているか。旧い中分類の記録がある中分類は、全節を完了として扱う */
export function isEntryDone(records: NotebookRecords, unit: string, entry: string): boolean {
  return records.units.has(unit) || hasEntryRecord(records, unit, entry);
}

export type UnitProgress = {
  /** 完了した節の数 */
  done: number;
  /** 画面に出す節の数 */
  total: number;
  /** 履修済み(節が 1 つ以上あり、すべて完了)。見出しのない中分類は履修済みにならない */
  completed: boolean;
  /** 履修済みの時刻。旧い中分類の記録があればその時刻、なければ節の完了の時刻のうち最も遅いもの */
  completedAt: string | undefined;
};

function latestOf(times: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const time of times) {
    const value = Date.parse(time);
    if (!Number.isNaN(value) && value > bestTime) {
      best = time;
      bestTime = value;
    }
  }
  return best ?? times[0];
}

/** 中分類の進み具合。記録にあっても、画面に出す節にないもの(ノートにない見出しの ID)は数えない */
export function unitProgress(unit: SectionUnit, records: NotebookRecords): UnitProgress {
  const total = unit.entries.length;
  const legacy = records.units.get(unit.id);
  const times = unit.entries.flatMap((entry) => records.entries.get(sectionKey(unit.id, entry.id)) ?? []);
  const done = legacy === undefined ? times.length : total;
  const completed = total > 0 && done === total;
  return { done, total, completed, completedAt: completed ? (legacy ?? latestOf(times)) : undefined };
}

/** 履修済みにできる中分類(画面に出す見出しのある中分類)。目次の並び */
export function completableUnits(toc: readonly TocDomain[]): TocUnit[] {
  return toc.flatMap((domain) => domain.units.filter((unit) => unit.count > 0));
}

/** 全体の、完了した節の数と履修済みの中分類の数(分母は、画面に出す節と、見出しのある中分類) */
export function overallProgress(toc: readonly TocDomain[], records: NotebookRecords) {
  const units = completableUnits(toc);
  const progress = units.map((unit) => unitProgress(unit, records));
  return {
    doneEntries: progress.reduce((sum, p) => sum + p.done, 0),
    totalEntries: progress.reduce((sum, p) => sum + p.total, 0),
    doneUnits: progress.filter((p) => p.completed).length,
    totalUnits: units.length,
  };
}

/** 分野の中の履修済みの数(分母は、画面に出す見出しのある中分類) */
export function domainProgress(domain: TocDomain, records: NotebookRecords) {
  const units = completableUnits([domain]);
  return {
    doneUnits: units.filter((unit) => unitProgress(unit, records).completed).length,
    totalUnits: units.length,
  };
}

/** 目次の順に並べた節 */
export type SectionRef = { unit: TocUnit; entry: TocEntry };

export function tocSections(toc: readonly TocDomain[]): SectionRef[] {
  return toc.flatMap((domain) => domain.units.flatMap((unit) => unit.entries.map((entry) => ({ unit, entry }))));
}

/**
 * 「続きから」の指す先: 目次の順で最初の、完了していない節(見出しのない中分類は飛ばす)。
 * すべて完了なら `"all-done"`、節がなければ null。
 */
export function continueSection(toc: readonly TocDomain[], records: NotebookRecords): SectionRef | "all-done" | null {
  const sections = tocSections(toc);
  if (sections.length === 0) return null;
  return sections.find((s) => !isEntryDone(records, s.unit.id, s.entry.id)) ?? "all-done";
}

/**
 * 中分類の URL の移し先の節: 最初の、完了していない節。すべて完了なら最初の節。
 * 記録を読めない(`records` が null)ときも最初の節。節がなければ undefined。
 */
export function resumeEntryId(unit: SectionUnit, records: NotebookRecords | null): string | undefined {
  const first = unit.entries[0];
  if (!first || !records) return first?.id;
  return (unit.entries.find((entry) => !isEntryDone(records, unit.id, entry.id)) ?? first).id;
}

/** 体系ノートの URL から、いまの中分類と節の ID を読む(表紙や、ほかの URL では未定義) */
export function currentOf(pathname: string, basePath: string): { unit?: string; entry?: string } {
  if (!pathname.startsWith(`${basePath}/`)) return {};
  const [unit, entry] = pathname.slice(basePath.length + 1).split("/");
  return { ...(unit ? { unit } : {}), ...(entry ? { entry } : {}) };
}

/** 履修した日の表示(日本時間の `YYYY/M/D`)。読めない時刻は空文字 */
export function completedDateLabel(completedAt: string): string {
  const time = Date.parse(completedAt);
  if (Number.isNaN(time)) return "";
  const date = new Date(time + 9 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}
