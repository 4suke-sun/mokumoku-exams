import { describe, expect, it } from "vitest";
import type { GuideRecord } from "../collect/ledger.ts";
import { computeCoverage } from "./coverage.ts";
import { card } from "./test-helpers.ts";

const guide: GuideRecord = {
  sourceUrl: "https://docs.aws.amazon.com/guide/index.html",
  contentHash: "a".repeat(64),
  pages: [],
  importedAt: "2026-10-13",
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.5, scope: ["項目 A", "項目 B", "項目 C"] },
    { code: "domain2", name: "分野 2", weight: 0.5, scope: ["項目 D"] },
  ],
};

describe("カバレッジ", () => {
  it("分野ごとの件数を数え、試験ガイドの範囲にカードのない項目を抜けとして返す", () => {
    const cards = [
      card({ id: "f-1", domain: "domain1", scopeItems: [0] }),
      card({ id: "f-2", domain: "domain1", scopeItems: [0, 2] }),
      card({ id: "f-3", domain: "domain1", status: "held", reasons: ["conflict"], scopeItems: [1] }),
      card({ id: "f-4", domain: "domain2", status: "rejected", reasons: ["long-copy"], scopeItems: [0] }),
    ];
    const r = computeCoverage(cards, ["domain1", "domain2", "domain3"], guide);
    expect(r.byDomain).toEqual([
      { domain: "domain1", passed: 2, held: 1, rejected: 0 },
      { domain: "domain2", passed: 0, held: 0, rejected: 1 },
      { domain: "domain3", passed: 0, held: 0, rejected: 0 },
    ]);
    // 保留・不採用のカードは、項目を満たしたことにならない
    expect(r.gaps).toEqual([
      { domain: "domain1", item: 1 },
      { domain: "domain2", item: 0 },
    ]);
  });

  it("試験ガイドがない_抜けは調べない", () => {
    expect(computeCoverage([card()], ["domain1"], null).gaps).toEqual([]);
  });

  it("結果_分野のコードと件数、項目の番号だけで、項目の文を含まない", () => {
    const r = computeCoverage([], ["domain1", "domain2"], guide);
    expect(JSON.stringify(r)).not.toContain("項目 A");
  });
});
