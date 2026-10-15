/**
 * 手元の計測。どこが重いか(時間、トークン、再検査の回数)を調べるための記録と集計。
 * 置き場は `.git` の共有領域(リポジトリの外)で、作業ツリーをまたいで合算される。純粋な関数だけを置く(読み書きは scripts/metrics.ts)。
 * 記録するのは数値と段階・役の名前だけで、入力の値は持たない。
 */
import { join } from "node:path";
import type { Ledger } from "./inspection-ledger.ts";

export interface VerifyStage {
  name: string;
  ms: number;
  ok: boolean;
}

export type MetricRecord =
  | { type: "verify"; at: string; stages: VerifyStage[] }
  | { type: "agent"; at: string; name: string; ms: number; tokens: number };

const METRICS_FILE = "mokumoku-metrics.jsonl";

/** サブエージェントの役の名前の形。書き込み(scripts/metrics.ts)と読み込み(parseMetrics)の両方で使う。 */
export const AGENT_NAME = /^[a-z][a-z0-9-]{1,39}$/;

export function metricsPath(gitCommonDir: string): string {
  return join(gitCommonDir, METRICS_FILE);
}

export function serializeMetric(record: MetricRecord): string {
  return `${JSON.stringify(record)}\n`;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= COUNT_MAX;
}

function isStage(value: unknown): value is VerifyStage {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.name === "string" && isCount(s.ms) && typeof s.ok === "boolean";
}

/** 記録を読む。壊れた行・形の合わない行は飛ばす。 */
export function parseMetrics(text: string): MetricRecord[] {
  const out: MetricRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      if (typeof r.at !== "string") continue;
      if (r.type === "verify" && Array.isArray(r.stages) && r.stages.every(isStage)) {
        out.push({ type: "verify", at: r.at, stages: r.stages });
      } else if (
        r.type === "agent" &&
        typeof r.name === "string" &&
        AGENT_NAME.test(r.name) &&
        isCount(r.ms) &&
        isCount(r.tokens)
      ) {
        out.push({ type: "agent", at: r.at, name: r.name, ms: r.ms, tokens: r.tokens });
      }
    } catch {
      // 壊れた行は読まない
    }
  }
  return out;
}

export interface StageSummary {
  name: string;
  runs: number;
  failures: number;
  avgMs: number;
  maxMs: number;
}

/** `verify` の段階ごとの平均・最大の時間と、失敗の回数。平均の長い順。 */
export function summarizeVerify(records: MetricRecord[]): StageSummary[] {
  const byName = new Map<string, VerifyStage[]>();
  for (const r of records) {
    if (r.type !== "verify") continue;
    for (const s of r.stages) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
  }
  return [...byName]
    .map(([name, stages]) => ({
      name,
      runs: stages.length,
      failures: stages.filter((s) => !s.ok).length,
      avgMs: Math.round(stages.reduce((sum, s) => sum + s.ms, 0) / stages.length),
      maxMs: Math.max(...stages.map((s) => s.ms)),
    }))
    .sort((a, b) => b.avgMs - a.avgMs || a.name.localeCompare(b.name));
}

export interface AgentSummary {
  name: string;
  runs: number;
  avgMs: number;
  avgTokens: number;
  totalTokens: number;
}

/** サブエージェントの役ごとの、平均の時間とトークン。トークンの合計の多い順。 */
export function summarizeAgents(records: MetricRecord[]): AgentSummary[] {
  const byName = new Map<string, { ms: number; tokens: number }[]>();
  for (const r of records) {
    if (r.type !== "agent") continue;
    byName.set(r.name, [...(byName.get(r.name) ?? []), { ms: r.ms, tokens: r.tokens }]);
  }
  return [...byName]
    .map(([name, runs]) => {
      const totalTokens = runs.reduce((sum, x) => sum + x.tokens, 0);
      return {
        name,
        runs: runs.length,
        avgMs: Math.round(runs.reduce((sum, x) => sum + x.ms, 0) / runs.length),
        avgTokens: Math.round(totalTokens / runs.length),
        totalTokens,
      };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name));
}

/** 台帳の判定の内訳(検査の種類ごとの OK・WARN・BLOCK の件数)。 */
export function summarizeLedger(ledger: Ledger): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const e of ledger.entries) {
    const row = out[e.kind] ?? {};
    row[e.verdict] = (row[e.verdict] ?? 0) + 1;
    out[e.kind] = row;
  }
  return out;
}

/** 記録できる数の上限(12 桁)。書き込み(parseCount)と読み込み(isCount)の両方で使う。 */
export const COUNT_MAX = 999_999_999_999;

/** 非負の整数の文字列だけを数にする(空文字・負数・小数・指数表記・上限超えは null)。 */
export function parseCount(value: string | undefined): number | null {
  return value !== undefined && /^\d{1,12}$/.test(value) ? Number(value) : null;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export function formatReport(parts: {
  verify: StageSummary[];
  agents: AgentSummary[];
  ledger: Record<string, Record<string, number>>;
  inbox: Record<"who" | "cause" | "promote", Record<string, number>>;
}): string {
  const lines: string[] = ["## verify の段階ごとの時間(平均 / 最大 / 実行回数 / 失敗)"];
  if (parts.verify.length === 0) lines.push("(記録なし。npm run verify を実行すると記録される)");
  for (const s of parts.verify) {
    lines.push(`- ${s.name}: ${seconds(s.avgMs)} / ${seconds(s.maxMs)} / ${s.runs} / ${s.failures}`);
  }
  lines.push("", "## サブエージェントの役ごとの時間とトークン(平均の時間 / 平均のトークン / 回数)");
  if (parts.agents.length === 0)
    lines.push("(記録なし。node scripts/metrics.ts agent <役> <ミリ秒> <トークン> で足す)");
  for (const a of parts.agents) lines.push(`- ${a.name}: ${seconds(a.avgMs)} / ${a.avgTokens} / ${a.runs}`);
  lines.push("", "## 検査の台帳の判定の内訳");
  const kinds = Object.keys(parts.ledger).sort();
  if (kinds.length === 0) lines.push("(記録なし)");
  for (const kind of kinds) {
    const row = parts.ledger[kind] ?? {};
    lines.push(`- ${kind}: ${["OK", "WARN", "BLOCK"].map((v) => `${v} ${row[v] ?? 0}`).join(" / ")}`);
  }
  lines.push("", "## 引っかかりの受け箱の内訳");
  for (const field of ["who", "cause", "promote"] as const) {
    const row = parts.inbox[field];
    const text = Object.keys(row)
      .sort()
      .map((k) => `${k} ${row[k]}`)
      .join(" / ");
    lines.push(`- ${field}: ${text === "" ? "(記録なし)" : text}`);
  }
  return `${lines.join("\n")}\n`;
}
