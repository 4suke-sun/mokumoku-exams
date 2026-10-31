import { isOfficialTarget } from "./quiz.ts";
import type { SectionRecord } from "./storage.ts";
import type { Question } from "./types.ts";

// 5 問ずつのセクションで解くモード。選択式の問題を、データの並びのまま 5 問ずつに分ける。

/** 1 セクションの問題数 */
export const SECTION_SIZE = 5;
/** 合格の割合(5 問中 4 問)。問題数が少ない最後のセクションは、切り上げで数える */
export const SECTION_PASS_RATE = 0.8;

/** 問題 ID を、5 問ずつのセクションに分ける。最後のセクションは、5 問に満たないこともある */
export function sectionsOf<T>(items: readonly T[], size: number = SECTION_SIZE): T[][] {
  const sections: T[][] = [];
  for (let i = 0; i < items.length; i += size) sections.push(items.slice(i, i + size));
  return sections;
}

/**
 * セクションで出題する問題。選択式(択一・複数選択)の問題だけで、自由記述は含めない。
 * セクションの記録は番号で持つので、区切りを計算するところは、すべてこれを通す。
 */
export function sectionTargets<T extends { questionType: Question["questionType"] }>(
  items: readonly T[],
): (T & { questionType: "single" | "multiple" })[] {
  return items.filter((item): item is T & { questionType: "single" | "multiple" } => isOfficialTarget(item));
}

/** セクションの合格に要る正答数(8 割の切り上げ) */
export function sectionPassLine(total: number): number {
  return Math.ceil(total * SECTION_PASS_RATE - 1e-9);
}

export type SectionStatus = "perfect" | "passed" | "failed" | "untried";

/** セクションの状態。満点・合格・未達・未挑戦 */
export function sectionStatus(record: Pick<SectionRecord, "correct" | "total" | "retry"> | undefined): SectionStatus {
  if (!record) return "untried";
  // 満点は、通しで 1 回で全問正解したときだけ(解き直しで合格にした記録は、合格まで)
  if (record.correct >= record.total && !record.retry) return "perfect";
  return record.correct >= sectionPassLine(record.total) ? "passed" : "failed";
}

/**
 * 解き直しの採点から、セクションを合格に上げる記録を作る。解き直した問題をすべて正解し、
 * いまの記録が未達のときだけ返す(未挑戦・合格・満点のときは、変えないので null)。
 * 正答数は合格に要る数にして、記録の比べ方(正答数の多いほうを残す)のまま、未達の記録より上に来るようにする。
 */
export function retryPassRecord(
  before: SectionRecord | undefined,
  attempt: { correct: number; total: number },
  finishedAt: string,
): SectionRecord | null {
  if (!before || attempt.total === 0 || attempt.correct < attempt.total) return null;
  if (sectionStatus(before) !== "failed") return null;
  return { correct: sectionPassLine(before.total), total: before.total, finishedAt, retry: true };
}

/** 合格(満点を含む)したセクションの数 */
export function passedSectionCount(best: Readonly<Record<string, SectionRecord>>, total: number): number {
  let passed = 0;
  for (let i = 0; i < total; i++) {
    const status = sectionStatus(Object.hasOwn(best, String(i)) ? best[String(i)] : undefined);
    if (status === "passed" || status === "perfect") passed++;
  }
  return passed;
}
