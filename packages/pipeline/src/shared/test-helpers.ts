import { cpSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentDefinitionPath, PIPELINE_ROLES, type PipelineRole, readAgentStamp } from "./agents.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

/** 作業ディレクトリ(一時)に、リポジトリのエージェントの定義を写す */
export function installAgentDefinitions(root: string): void {
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  for (const role of PIPELINE_ROLES) cpSync(agentDefinitionPath(repoRoot, role), agentDefinitionPath(root, role));
}

/**
 * リポジトリの設定から、テストで例に使う試験の個別の設定(出題計画の上書き、基準で承認を省く対象)を外す。
 * テストの期待値を、本番の試験ごとの調整に左右されないようにする
 */
export function withoutExamSettings<
  T extends { plan: { overrides: Record<string, unknown> }; review: { autoApprove?: string[] } },
>(config: T, examCode: string): T {
  const { [examCode]: _removed, ...overrides } = config.plan.overrides;
  const autoApprove = config.review.autoApprove?.filter((code) => code !== examCode);
  return {
    ...config,
    plan: { ...config.plan, overrides },
    review: { ...config.review, ...(autoApprove === undefined ? {} : { autoApprove }) },
  };
}

/** リポジトリの定義の、いまのハッシュ(依頼の鍵を、テストで組み立てるときに使う) */
export function repoDefinitionHash(role: PipelineRole): string {
  return readAgentStamp(repoRoot, role).definitionHash;
}
