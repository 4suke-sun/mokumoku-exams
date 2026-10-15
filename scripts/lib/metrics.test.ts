import { describe, expect, it } from "vitest";
import {
  formatReport,
  type MetricRecord,
  metricsPath,
  parseCount,
  parseMetrics,
  serializeMetric,
  summarizeAgents,
  summarizeLedger,
  summarizeVerify,
} from "./metrics.ts";

const verify = (stages: [string, number, boolean][]): MetricRecord => ({
  type: "verify",
  at: "t",
  stages: stages.map(([name, ms, ok]) => ({ name, ms, ok })),
});

describe("parseMetrics", () => {
  it("壊れた行と形の合わない行_飛ばして読める行だけ返す", () => {
    const text = [
      serializeMetric(verify([["lint", 1000, true]])),
      "not json\n",
      `${JSON.stringify({ type: "agent", at: "t", name: "inspector", ms: "x", tokens: 1 })}\n`,
      serializeMetric({ type: "agent", at: "t", name: "inspector", ms: 5000, tokens: 40000 }),
    ].join("");
    expect(parseMetrics(text).map((r) => r.type)).toEqual(["verify", "agent"]);
  });
});

describe("parseMetrics の検査", () => {
  it("役の名前が不正、または数が負・小数・上限超え_読み込まない(書き込み側と同じ検査)", () => {
    const line = (over: Record<string, unknown>) =>
      `${JSON.stringify({ type: "agent", at: "t", name: "inspector", ms: 1000, tokens: 2000, ...over })}\n`;
    const text = [
      line({}),
      line({ name: "Bad Name" }),
      line({ ms: -1 }),
      line({ tokens: 1.5 }),
      line({ ms: 1_000_000_000_000 }),
    ].join("");
    expect(parseMetrics(text)).toHaveLength(1);
  });
});

describe("parseMetrics の verify の記録", () => {
  it("段階の時間が負・小数・上限超え_読み込まず、正しい記録だけ残す", () => {
    const line = (ms: number) =>
      `${JSON.stringify({ type: "verify", at: "t", stages: [{ name: "lint", ms, ok: true }] })}\n`;
    const text = [line(1000), line(-1), line(1.5), line(1_000_000_000_000)].join("");
    expect(parseMetrics(text)).toHaveLength(1);
  });
});

describe("summarizeVerify", () => {
  it("複数回の実行_段階ごとに平均・最大・失敗の回数を出し、平均の長い順に並べる", () => {
    const records = [
      verify([
        ["lint", 1000, true],
        ["test", 9000, true],
      ]),
      verify([
        ["lint", 3000, true],
        ["test", 11000, false],
      ]),
    ];
    expect(summarizeVerify(records)).toEqual([
      { name: "test", runs: 2, failures: 1, avgMs: 10000, maxMs: 11000 },
      { name: "lint", runs: 2, failures: 0, avgMs: 2000, maxMs: 3000 },
    ]);
  });
});

describe("summarizeAgents", () => {
  it("役ごとの記録_平均の時間とトークンを出し、トークンの合計の多い順に並べる", () => {
    const records: MetricRecord[] = [
      { type: "agent", at: "t", name: "commit-writer", ms: 10000, tokens: 20000 },
      { type: "agent", at: "t", name: "inspector", ms: 40000, tokens: 50000 },
      { type: "agent", at: "t", name: "inspector", ms: 60000, tokens: 70000 },
    ];
    expect(summarizeAgents(records)).toEqual([
      { name: "inspector", runs: 2, avgMs: 50000, avgTokens: 60000, totalTokens: 120000 },
      { name: "commit-writer", runs: 1, avgMs: 10000, avgTokens: 20000, totalTokens: 20000 },
    ]);
  });
});

describe("summarizeLedger", () => {
  it("台帳の記録_検査の種類ごとに判定の件数を数える", () => {
    const entry = (kind: "inspector" | "mechanical", verdict: "OK" | "WARN") => ({
      patchId: "p",
      kind,
      verdict,
      rules: "r",
    });
    expect(
      summarizeLedger({ entries: [entry("inspector", "OK"), entry("inspector", "WARN"), entry("mechanical", "OK")] }),
    ).toEqual({ inspector: { OK: 1, WARN: 1 }, mechanical: { OK: 1 } });
  });
});

describe("formatReport と置き場", () => {
  it("記録がない_記録のしかたを案内する", () => {
    const text = formatReport({
      verify: [],
      agents: [],
      ledger: {},
      inbox: { who: {}, cause: {}, promote: {} },
    });
    expect(text).toContain("npm run verify を実行すると記録される");
    expect(text).toContain("node scripts/metrics.ts agent");
  });

  it("共有領域のパス_.git の共通ディレクトリの下に置く", () => {
    expect(metricsPath("/repo/.git")).toBe("/repo/.git/mokumoku-metrics.jsonl");
  });
});

describe("parseCount", () => {
  it("非負の整数の文字列_数にする", () => {
    expect(parseCount("0")).toBe(0);
    expect(parseCount("49000")).toBe(49000);
  });

  it("空文字・負数・小数・指数表記・未指定_受け付けない", () => {
    for (const value of ["", "-1", "1.5", "1e3", "abc", undefined]) {
      expect(parseCount(value)).toBeNull();
    }
  });
});
