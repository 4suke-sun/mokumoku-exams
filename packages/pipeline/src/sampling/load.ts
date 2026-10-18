import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "../config.ts";
import { type DecisionsFile, decisionsPath, readDecisions } from "../decisions/decisions.ts";
import { type ProvenanceFile, provenancePath, readProvenance } from "../draft/provenance.ts";
import { draftWorkDir, readDrafts } from "../draft/store.ts";
import { type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { computeSampling, type EvalSummary, type SamplingPlan } from "./plan.ts";
import { readSampling, samplingPath } from "./store.ts";

/**
 * 抜き取りの計画を、置き場から読んで求める。評価のレポートがあれば、目標を満たしたかと検証役の定義のハッシュを読む。
 * 読むだけで、何も書かない。呼び出し側が、必要なら記録を書く。
 */

function readEvalSummary(path: string): EvalSummary | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      agent?: { definitionHash?: unknown };
      metrics?: { meetsTargets?: unknown };
    };
    const hash = raw.agent?.definitionHash;
    const meets = raw.metrics?.meetsTargets;
    return typeof hash === "string" && typeof meets === "boolean"
      ? { definitionHash: hash, meetsTargets: meets }
      : null;
  } catch {
    return null;
  }
}

export interface LoadedSampling {
  plan: SamplingPlan;
  paths: { record: string };
}

/** 事実カード・下書き・来歴・人の判断の記録を渡して計画を求める(すでに読んだものを使うとき) */
export function planFor(
  config: Config,
  rootDir: string,
  examCode: string,
  data: {
    facts: FactsFile;
    drafts: ReturnType<typeof readDrafts>;
    provenance: ProvenanceFile;
    decisions: DecisionsFile;
  },
): LoadedSampling {
  const record = samplingPath(resolve(rootDir, config.decisionsDir), examCode);
  const previous = readSampling(record, examCode);
  const evalSummary = readEvalSummary(
    join(resolve(rootDir, config.workDir), "eval", examCode.toLowerCase(), "report.json"),
  );
  const plan = computeSampling({
    settings: config.review,
    holdThreshold: config.draft.similarity.hold,
    drafts: data.drafts,
    facts: data.facts,
    provenance: data.provenance,
    decisions: data.decisions,
    evalSummary,
    verifierDefinitionHash: readAgentStamp(rootDir, "question-verifier").definitionHash,
    previous: previous === null ? null : { reviewedDraftIds: previous.draft.reviewed },
  });
  return { plan, paths: { record } };
}

/**
 * 数えるときに使う計画。記録(`--review` が書いたもの)があれば、それを使う(判断が増えても、確認の対象は変わらない)。なければ、求める
 */
export function recordedOrComputed(
  config: Config,
  rootDir: string,
  examCode: string,
  data: Parameters<typeof planFor>[3],
): SamplingPlan {
  const record = readSampling(samplingPath(resolve(rootDir, config.decisionsDir), examCode), examCode);
  if (record !== null) {
    const { examCode: _omit, ...plan } = record;
    return plan;
  }
  return planFor(config, rootDir, examCode, data).plan;
}

/** すべてを置き場から読んで計画を求める */
export function loadPlan(config: Config, rootDir: string, examCode: string): LoadedSampling {
  const work = resolve(rootDir, config.workDir);
  return planFor(config, rootDir, examCode, {
    facts: readFacts(factsPath(resolve(rootDir, config.factsDir), examCode), examCode),
    drafts: readDrafts(join(draftWorkDir(work, examCode), "drafts.json"), examCode),
    provenance: readProvenance(provenancePath(resolve(rootDir, config.provenanceDir), examCode), examCode),
    decisions: readDecisions(decisionsPath(resolve(rootDir, config.decisionsDir), examCode), examCode),
  });
}
