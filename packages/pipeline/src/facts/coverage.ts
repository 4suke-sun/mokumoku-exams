import type { GuideRecord } from "../collect/ledger.ts";
import type { FactCard } from "./schema.ts";

/**
 * 分野ごとの事実カードの数と、試験ガイドの範囲に対する抜け。
 * 報告は分野のコードと件数、項目の番号だけにする(本文も、項目の文も載せない)。
 */

export interface DomainCount {
  domain: string;
  passed: number;
  held: number;
  rejected: number;
}

export interface Gap {
  domain: string;
  /** 試験ガイドのその分野の出題範囲の、何番目の項目か(0 から) */
  item: number;
}

export interface Coverage {
  byDomain: DomainCount[];
  gaps: Gap[];
}

/** 先の段階へ進めるカード(passed)だけを、カバレッジに数える */
export function computeCoverage(
  cards: readonly FactCard[],
  domains: readonly string[],
  guide: GuideRecord | null,
): Coverage {
  const byDomain: DomainCount[] = domains.map((domain) => {
    const inDomain = cards.filter((c) => c.domain === domain);
    return {
      domain,
      passed: inDomain.filter((c) => c.status === "passed").length,
      held: inDomain.filter((c) => c.status === "held").length,
      rejected: inDomain.filter((c) => c.status === "rejected").length,
    };
  });
  const gaps: Gap[] = [];
  for (const d of guide?.domains ?? []) {
    const covered = new Set(
      cards.filter((c) => c.domain === d.code && c.status === "passed").flatMap((c) => c.scopeItems),
    );
    d.scope.forEach((_, item) => {
      if (!covered.has(item)) gaps.push({ domain: d.code, item });
    });
  }
  return { byDomain, gaps };
}
