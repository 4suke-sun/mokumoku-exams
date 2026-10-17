import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { LedgerError, type LedgerFile, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { ProvenanceError, type ProvenanceFile, provenancePath, readProvenance } from "../draft/provenance.ts";
import { DraftsError, type DraftsFile, draftWorkDir, readDrafts, readState } from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { PlanError, type PlanFile, planPath, readPlan } from "../plan/schema.ts";
import {
  AgentDefinitionError,
  type AgentStamp,
  PIPELINE_ROLES,
  type PipelineRole,
  readAgentStamp,
} from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { listRequestFiles } from "../shared/request-flow.ts";

/**
 * status コマンド: 段階ごとの状態を表示する。読むだけで、何も書かない(ADR 0009)。
 * 出力は、種類と場所と件数だけで、本文は出さない。読めないファイルは、場所だけを報告して、終了コード 1 で終わる。
 * 予算は、件数と役のモデルの表示にとどめる(モデルを呼ぶのはエージェントで、CLI はトークンも費用も測れない)。
 */

export interface StatusOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  output: Output;
}

/** 依頼のファイルがあり、出力がないもの(依頼待ち)と、出力のファイルがあるもの(取り込み待ち)の件数 */
function queue(requestsDir: string, outDir: string): { waiting: number; toImport: number } {
  const requests = listRequestFiles(requestsDir);
  const outs = new Set(existsSync(outDir) ? readdirSync(outDir).filter((f) => f.endsWith(".json")) : []);
  return {
    waiting: requests.filter((f) => !outs.has(f)).length,
    toImport: requests.filter((f) => outs.has(f)).length,
  };
}

function countBy(values: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

export function runStatus(options: StatusOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const work = resolve(rootDir, config.workDir);
  const code = examCode.toLowerCase();
  const paths = {
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    provenance: provenancePath(resolve(rootDir, config.provenanceDir), examCode),
    plan: planPath(work, examCode),
    drafts: join(draftWorkDir(work, examCode), "drafts.json"),
    draftState: join(draftWorkDir(work, examCode), "state.json"),
  };
  const stamps = new Map<PipelineRole, AgentStamp>();
  let broken = false;
  const read = <T>(reader: () => T, label: Parameters<typeof report>[1]): T | null => {
    try {
      return reader();
    } catch (error) {
      if (
        error instanceof LedgerError ||
        error instanceof FactsError ||
        error instanceof ProvenanceError ||
        error instanceof PlanError ||
        error instanceof DraftsError
      ) {
        for (const p of error.paths) report(output, label, p);
        broken = true;
        return null;
      }
      throw error;
    }
  };
  const l = read(() => readLedger(paths.ledger, examCode), "台帳の誤り");
  const f = read(() => readFacts(paths.facts, examCode), "事実カードの誤り");
  const pv = read(() => readProvenance(paths.provenance, examCode), "来歴の誤り");
  const pl = read(() => readPlan(paths.plan), "出題計画の誤り");
  const d = read(() => readDrafts(paths.drafts, examCode), "下書きの誤り");
  for (const role of PIPELINE_ROLES) {
    try {
      stamps.set(role, readAgentStamp(rootDir, role));
    } catch (error) {
      if (!(error instanceof AgentDefinitionError)) throw error;
      report(output, "エージェントの定義の誤り", error.role);
      broken = true;
    }
  }
  if (broken || l === null || f === null || pv === null || d === null) return EXIT.checkFailed;
  const ledger: LedgerFile = l;
  const facts: FactsFile = f;
  const provenance: ProvenanceFile = pv;
  const plan: PlanFile | null = pl;
  const drafts: DraftsFile = d;

  const line = (text: string) => report(output, "状態", text);
  const guideRequest = existsSync(join(work, "guide", `${code}.request.json`));
  const guideExtract = existsSync(join(work, "guide", `${code}.extract.json`));
  const guide = {
    waiting: guideRequest && !guideExtract ? 1 : 0,
    toImport: guideExtract ? 1 : 0,
  };
  line(`収集 出典 ${ledger.sources.length} 件、有効 ${ledger.sources.filter((s) => s.status === "active").length} 件`);
  line(
    `試験ガイド 取り込み${ledger.guide === null ? "なし" : "済み"}、依頼待ち ${guide.waiting} 件、取り込み待ち ${guide.toImport} 件`,
  );
  line(
    `再検証の印 事実カード ${new Set(ledger.recheck.facts).size} 件、下書き・問題 ${new Set(ledger.recheck.questions).size} 件`,
  );

  const factQueue = queue(join(work, "facts", code, "requests"), join(work, "facts", code, "out"));
  const factCount = (status: string) => facts.cards.filter((c) => c.status === status).length;
  line(
    `事実カード 依頼待ち ${factQueue.waiting} 件、取り込み待ち ${factQueue.toImport} 件、通過 ${factCount("passed")} 件、保留 ${factCount("held")} 件、不採用 ${factCount("rejected")} 件`,
  );
  for (const [reason, n] of countBy(facts.cards.filter((c) => c.status !== "passed").flatMap((c) => c.reasons))) {
    line(`事実カードの理由 ${reason} ${n} 件`);
  }

  const candidateQueue = queue(join(work, "candidates", code, "requests"), join(work, "candidates", code, "out"));
  line(`出典の候補 依頼待ち ${candidateQueue.waiting} 件、取り込み待ち ${candidateQueue.toImport} 件`);

  line(plan === null ? "出題計画 なし" : `出題計画 項目 ${plan.items.length} 件`);

  const draftQueue = queue(join(draftWorkDir(work, examCode), "requests"), join(draftWorkDir(work, examCode), "out"));
  const draftCount = (status: string) => drafts.drafts.filter((r) => r.status === status).length;
  const exported = provenance.entries.filter((e) => e.questionId !== undefined).length;
  line(
    `下書き 依頼待ち ${draftQueue.waiting} 件、取り込み待ち ${draftQueue.toImport} 件、通過 ${draftCount("passed")} 件、保留 ${draftCount("held")} 件、不採用 ${draftCount("rejected")} 件、書き出し済み ${exported} 件`,
  );
  for (const [reason, n] of countBy(drafts.drafts.flatMap((r) => (r.status === "passed" ? [] : r.reasons)))) {
    line(`下書きの理由 ${reason} ${n} 件`);
  }
  const unmet = Object.entries(readState(paths.draftState).unmet).sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [item, reasons] of unmet) line(`未達 ${item} ${reasons.join(",")}`);

  const verifyQueue = queue(join(work, "verify", code, "requests"), join(work, "verify", code, "out"));
  const verdicts = drafts.drafts.flatMap((r) => (r.verification ? [r.verification.verdict] : []));
  const verdictCount = (v: string | null) => verdicts.filter((x) => x === v).length;
  const unverified = drafts.drafts.filter((r) => r.status !== "rejected" && r.verification === undefined).length;
  line(
    `検証 依頼待ち ${verifyQueue.waiting} 件、取り込み待ち ${verifyQueue.toImport} 件、合格 ${verdictCount("pass")} 件、保留 ${verdictCount("hold")} 件、不採用 ${verdictCount("reject")} 件、解説の確認待ち ${verdictCount(null)} 件、検証前 ${unverified} 件`,
  );
  for (const [reason, n] of countBy(drafts.drafts.flatMap((r) => r.verification?.reasons ?? []))) {
    line(`検証の理由 ${reason} ${n} 件`);
  }

  const waitingByRole: Record<PipelineRole, number> = {
    "source-scout": candidateQueue.waiting,
    "guide-extractor": guide.waiting,
    "fact-extractor": factQueue.waiting,
    "question-drafter": draftQueue.waiting,
    "question-verifier": verifyQueue.waiting,
  };
  for (const role of PIPELINE_ROLES) {
    const stamp = stamps.get(role) as AgentStamp;
    line(`役 ${role} ${stamp.model} 定義 ${stamp.definitionHash.slice(0, 12)}`);
  }
  line(
    `見積もり 依頼待ち ${PIPELINE_ROLES.map((role) => `${role} ${waitingByRole[role]} 件 × ${(stamps.get(role) as AgentStamp).model}`).join("、")}。1 回の実行の上限 ${config.maxItemsPerRun} 件`,
  );
  return EXIT.ok;
}
