import { sha256 } from "../collect/fetcher.ts";
import type { Config } from "../config.ts";
import { type AgentStamp, type PipelineRole, readAgentStamp } from "../shared/agents.ts";

/**
 * 評価の対象(プロンプト、モデルの指定、検証の設定)のハッシュ。評価の関門(eval-gate)が、台帳の合格の記録と突き合わせる。
 * 役の定義のハッシュ(モデルの ID と指示の本文)と、設定の評価に関わる節のハッシュから決める。
 * しきい値(`eval.targets`、`judge.eval.targets`)は、対象に含めない(しきい値の調整は、eval-sweep の台帳で扱う)。
 */

export const GATE_ROLES = ["verifier", "judge"] as const;
export type GateRole = (typeof GATE_ROLES)[number];

export const AGENT_OF: Record<GateRole, PipelineRole> = { verifier: "question-verifier", judge: "question-judge" };
/** 評価のレポートの置き場(作業用の置き場の下の名前) */
export const REPORT_DIR: Record<GateRole, string> = { verifier: "eval", judge: "judge-eval" };

/** キーを並べ替えた JSON。同じ内容は同じ文字列になる。 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 評価に関わる設定の節。しきい値は除く。 */
export function settingsOf(role: GateRole, config: Config): unknown {
  if (role === "verifier") {
    const { targets: _targets, ...evalSettings } = config.eval;
    return { verify: config.verify, eval: evalSettings };
  }
  const { targets: _targets, ...judgeEval } = config.judge.eval;
  return { judge: { ...config.judge, eval: judgeEval } };
}

export interface Subject {
  agent: AgentStamp;
  settingsHash: string;
  subjectHash: string;
}

export function subjectOf(role: GateRole, rootDir: string, config: Config): Subject {
  const agent = readAgentStamp(rootDir, AGENT_OF[role]);
  const settingsHash = sha256(canonicalJson(settingsOf(role, config)));
  return { agent, settingsHash, subjectHash: sha256(`${agent.definitionHash}\n${settingsHash}`) };
}
