import type { DecisionsFile } from "../decisions/decisions.ts";
import { type DraftsFile, REVISED } from "../draft/store.ts";
import type { FactsFile } from "../facts/schema.ts";
import { describeReason } from "./catalog.ts";

/**
 * 不採用と差し戻しの理由の集計。理由コードごと、論点(分野)ごと、段階ごとに、件数と割合を数える。
 * 持つのは、件数・割合・理由コード・ID だけで、問題の本文・選択肢・出典の本文は含めない。
 * 同じ入力からは、同じ集計ができる(並びは固定)。
 */

export const STAGES = ["facts", "draft", "verify", "human"] as const;
export type Stage = (typeof STAGES)[number];

/** 理由ごとに残す ID の数の上限 */
export const MAX_IDS = 20;

export interface StageRow {
  stage: Stage;
  /** その段階で判定された件数 */
  total: number;
  passed: number;
  held: number;
  rejected: number;
}

export interface ReasonRow {
  stage: Stage;
  code: string;
  count: number;
  /** count / その段階の total(total が 0 なら 0) */
  ratio: number;
  held: number;
  rejected: number;
  byDomain: Record<string, number>;
  /** 事実カードか下書きの ID(昇順で最大 MAX_IDS 件) */
  ids: string[];
  meaning: string;
  pattern: string;
  suggestion: string;
}

export interface DomainRow {
  stage: Stage;
  domain: string;
  total: number;
  held: number;
  rejected: number;
}

export interface HumanRow {
  target: "fact" | "draft";
  decision: string;
  reason: string;
  count: number;
}

export interface Summary {
  examCode: string;
  stages: StageRow[];
  domains: DomainRow[];
  reasons: ReasonRow[];
  human: HumanRow[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function stageOf(code: string, base: "facts" | "draft"): Stage {
  if (code === "human-rejected") return "human";
  if (code.startsWith("verify:")) return "verify";
  return base;
}

interface Item {
  id: string;
  domain: string;
  status: "passed" | "held" | "rejected";
  reasons: readonly string[];
  base: "facts" | "draft";
  /** 検証の判定(検証前、または解説の確認待ちは null) */
  verdict: "pass" | "hold" | "reject" | null;
}

export function aggregate(examCode: string, facts: FactsFile, drafts: DraftsFile, decisions: DecisionsFile): Summary {
  const items: Item[] = [
    ...facts.cards.map((c): Item => ({ ...c, base: "facts", verdict: null })),
    // 直した下書きに置き換わった下書き(理由 revised)は、欠陥による不採用ではなく、直した下書きの側で数えるので、集計に入れない
    ...drafts.drafts
      .filter((d) => !d.reasons.includes(REVISED))
      .map((d): Item => ({ ...d, base: "draft", verdict: d.verification?.verdict ?? null })),
  ];
  const humanDecisions = decisions.decisions.flatMap((d) =>
    d.target === "source" ? [] : [{ target: d.target, id: d.id, decision: d.decision, reason: d.reason }],
  );

  // 段階ごとの件数
  const stageRows = new Map<Stage, StageRow>(
    STAGES.map((s) => [s, { stage: s, total: 0, passed: 0, held: 0, rejected: 0 }]),
  );
  const bump = (stage: Stage, status: Item["status"]) => {
    const row = stageRows.get(stage) as StageRow;
    row.total++;
    row[status]++;
  };
  for (const item of items) {
    bump(item.base, item.status);
    // 検証の段階は、判定が出たもの(合格・保留・不採用)だけを数える。検証前と解説の確認待ち(判定が null)は数えない。
    // 人の判断で状態が変わっても、検証の判定そのもの(verdict)で数える
    if (item.verdict !== null)
      bump("verify", item.verdict === "pass" ? "passed" : item.verdict === "hold" ? "held" : "rejected");
  }
  const human = stageRows.get("human") as StageRow;
  human.total = humanDecisions.length;
  human.passed = humanDecisions.filter((d) => d.decision !== "reject").length;
  human.rejected = humanDecisions.filter((d) => d.decision === "reject").length;

  // 理由ごと
  const reasonMap = new Map<string, ReasonRow>();
  const domainMap = new Map<string, DomainRow>();
  for (const item of items) {
    if (item.status === "passed") continue;
    const seenStages = new Set<Stage>();
    for (const code of item.reasons) {
      const stage = stageOf(code, item.base);
      const key = `${stage}\u0000${code}`;
      let row = reasonMap.get(key);
      if (row === undefined) {
        const info = describeReason(code);
        row = {
          stage,
          code,
          count: 0,
          ratio: 0,
          held: 0,
          rejected: 0,
          byDomain: {},
          ids: [],
          meaning: info.meaning,
          pattern: info.pattern,
          suggestion: info.suggestion,
        };
        reasonMap.set(key, row);
      }
      row.count++;
      row[item.status === "held" ? "held" : "rejected"]++;
      row.byDomain[item.domain] = (row.byDomain[item.domain] ?? 0) + 1;
      row.ids.push(item.id);
      seenStages.add(stage);
    }
    for (const stage of seenStages) {
      const key = `${stage}\u0000${item.domain}`;
      const row = domainMap.get(key) ?? { stage, domain: item.domain, total: 0, held: 0, rejected: 0 };
      row.total++;
      row[item.status === "held" ? "held" : "rejected"]++;
      domainMap.set(key, row);
    }
  }
  const reasons = [...reasonMap.values()]
    .map((r) => {
      const total = (stageRows.get(r.stage) as StageRow).total;
      return {
        ...r,
        ratio: total === 0 ? 0 : r.count / total,
        byDomain: Object.fromEntries(Object.entries(r.byDomain).sort(([a], [b]) => byString(a, b))),
        ids: [...new Set(r.ids)].sort(byString).slice(0, MAX_IDS),
      };
    })
    .sort((a, b) => b.count - a.count || byString(a.stage, b.stage) || byString(a.code, b.code));

  const humanMap = new Map<string, HumanRow>();
  for (const d of humanDecisions) {
    const key = `${d.target}\u0000${d.decision}\u0000${d.reason}`;
    const row = humanMap.get(key) ?? { target: d.target, decision: d.decision, reason: d.reason, count: 0 };
    row.count++;
    humanMap.set(key, row);
  }

  return {
    examCode,
    stages: STAGES.map((s) => stageRows.get(s) as StageRow),
    domains: [...domainMap.values()].sort((a, b) => byString(a.stage, b.stage) || byString(a.domain, b.domain)),
    reasons,
    human: [...humanMap.values()].sort(
      (a, b) => b.count - a.count || byString(a.target, b.target) || byString(a.reason, b.reason),
    ),
  };
}

const STAGE_LABEL: Record<Stage, string> = {
  facts: "事実カード",
  draft: "下書き",
  verify: "検証",
  human: "人の確認",
};

const percent = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

/** 人が読んで、下書きの指示を直すかを判断するための要約(Markdown)。件数・割合・理由コード・ID だけで、本文は載せない */
export function renderSummary(summary: Summary): string {
  const lines = [
    `# 不採用と差し戻しの理由の集計(${summary.examCode})`,
    "",
    "件数と割合は、その段階で判定された件数に対するもの(検証は、判定が出たもの)。問題の本文・選択肢・出典の本文は含まない。",
    "",
    "## 段階ごと",
    "",
    "| 段階 | 件数 | 通過 | 保留 | 不採用 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary.stages.map((s) => `| ${STAGE_LABEL[s.stage]} | ${s.total} | ${s.passed} | ${s.held} | ${s.rejected} |`),
    "",
    "## 理由コードごと",
    "",
  ];
  if (summary.reasons.length === 0) {
    lines.push("保留・不採用・差し戻しの理由はありません。", "");
  } else {
    for (const r of summary.reasons) {
      lines.push(
        `### ${STAGE_LABEL[r.stage]}: \`${r.code}\` ${r.count} 件(${percent(r.ratio)})`,
        "",
        `- 意味: ${r.meaning}`,
        `- よくある型: ${r.pattern}`,
        `- 指示に足すとよい制約の候補: ${r.suggestion}`,
        `- 保留 ${r.held} 件、不採用 ${r.rejected} 件`,
        `- 論点ごと: ${Object.entries(r.byDomain)
          .map(([d, n]) => `${d} ${n} 件`)
          .join("、")}`,
        `- ID: ${r.ids.join(", ")}`,
        "",
      );
    }
  }
  lines.push("## 論点(分野)ごと", "");
  if (summary.domains.length === 0) lines.push("なし", "");
  else {
    lines.push("| 段階 | 分野 | 保留・不採用 | 保留 | 不採用 |", "| --- | --- | ---: | ---: | ---: |");
    for (const d of summary.domains) {
      lines.push(`| ${STAGE_LABEL[d.stage]} | ${d.domain} | ${d.total} | ${d.held} | ${d.rejected} |`);
    }
    lines.push("");
  }
  lines.push("## 人の判断の理由", "");
  if (summary.human.length === 0) lines.push("なし", "");
  else {
    lines.push("| 対象 | 判断 | 理由コード | 件数 |", "| --- | --- | --- | ---: |");
    for (const h of summary.human) lines.push(`| ${h.target} | ${h.decision} | \`${h.reason}\` | ${h.count} |`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
