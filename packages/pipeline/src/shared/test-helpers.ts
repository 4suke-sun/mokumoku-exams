import { cpSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { agentDefinitionPath, PIPELINE_ROLES, type PipelineRole, readAgentStamp } from "./agents.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

/** 作業ディレクトリ(一時)に、リポジトリのエージェントの定義を写す */
export function installAgentDefinitions(root: string): void {
  mkdirSync(join(root, ".claude", "agents"), { recursive: true });
  for (const role of PIPELINE_ROLES) cpSync(agentDefinitionPath(repoRoot, role), agentDefinitionPath(root, role));
}

/** リポジトリの定義の、いまのハッシュ(依頼の鍵を、テストで組み立てるときに使う) */
export function repoDefinitionHash(role: PipelineRole): string {
  return readAgentStamp(repoRoot, role).definitionHash;
}
