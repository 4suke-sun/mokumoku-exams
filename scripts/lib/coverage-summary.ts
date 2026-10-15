/** Vitest のカバレッジの集計(json-summary の coverage-summary.json)を、Markdown の表にする。 */

type Metric = { total: number; covered: number; pct: number };
export type Summary = { total: Record<"lines" | "statements" | "functions" | "branches", Metric> };

const NAMES = [
  ["lines", "行"],
  ["statements", "文"],
  ["functions", "関数"],
  ["branches", "分岐"],
] as const;

/** 集計を、Markdown の表にする。 */
export function coverageTable(summary: Summary): string {
  const rows = NAMES.map(([key, name]) => {
    const metric = summary.total[key];
    return `| ${name} | ${metric.pct}% | ${metric.covered} / ${metric.total} |`;
  });
  return ["### カバレッジ", "", "| 種類 | 割合 | 通った数 / 全体 |", "| --- | --- | --- |", ...rows, ""].join("\n");
}

export function isSummary(value: unknown): value is Summary {
  if (typeof value !== "object" || value === null || !("total" in value)) return false;
  const total = (value as { total: unknown }).total;
  return NAMES.every(([key]) => {
    const metric = (total as Record<string, unknown> | null)?.[key] as Partial<Metric> | undefined;
    return typeof metric?.pct === "number" && typeof metric.covered === "number" && typeof metric.total === "number";
  });
}
