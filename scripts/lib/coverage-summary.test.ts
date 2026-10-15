import { describe, expect, it } from "vitest";
import { coverageTable, isSummary } from "./coverage-summary.ts";

const metric = (covered: number, total: number) => ({ total, covered, pct: Math.round((covered / total) * 1000) / 10 });
const summary = {
  total: { lines: metric(80, 100), statements: metric(81, 100), functions: metric(9, 10), branches: metric(3, 4) },
};

describe("カバレッジの表", () => {
  it("集計がある_種類ごとの割合と数を表にする", () => {
    const table = coverageTable(summary);
    expect(table).toContain("| 行 | 80% | 80 / 100 |");
    expect(table).toContain("| 分岐 | 75% | 3 / 4 |");
  });

  it("形の違う集計_集計として扱わない", () => {
    expect(isSummary(summary)).toBe(true);
    expect(isSummary({ total: { lines: metric(1, 1) } })).toBe(false);
    expect(isSummary(null)).toBe(false);
  });
});
