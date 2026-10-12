import type { SectionRecord } from "./storage.ts";

// 5 問ずつのセクションで解くモード。全問を、データの並びのまま 5 問ずつに分ける。

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

/** セクションの合格に要る正答数(8 割の切り上げ) */
export function sectionPassLine(total: number): number {
  return Math.ceil(total * SECTION_PASS_RATE - 1e-9);
}

export type SectionStatus = "perfect" | "passed" | "failed" | "untried";

/** セクションの状態。満点・合格・未達・未挑戦 */
export function sectionStatus(record: Pick<SectionRecord, "correct" | "total"> | undefined): SectionStatus {
  if (!record) return "untried";
  if (record.correct >= record.total) return "perfect";
  return record.correct >= sectionPassLine(record.total) ? "passed" : "failed";
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
