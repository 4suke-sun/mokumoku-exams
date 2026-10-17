import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { type Output, report } from "../log.ts";

/**
 * パイプラインの役と、エージェントの定義(`.claude/agents/<役>.md`)の対応(ADR 0009)。
 * 役の一覧はここだけに持つ。段階はこの表を通して、モデルの ID と定義のハッシュを読む。
 */
export const PIPELINE_ROLES = ["guide-extractor", "fact-extractor", "question-drafter", "question-verifier"] as const;
export type PipelineRole = (typeof PIPELINE_ROLES)[number];

/** 依頼と取り込んだ結果に残す記録。役の名前、モデルの完全な ID、定義のハッシュだけを持ち、指示の本文は持たない */
export const AgentStampSchema = z.strictObject({
  role: z.enum(PIPELINE_ROLES),
  model: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,63}$/),
  definitionHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export type AgentStamp = z.infer<typeof AgentStampSchema>;

/** 定義を読めない、または `model:` がない。場所(役の名前)だけを持つ */
export class AgentDefinitionError extends Error {
  readonly role: string;
  constructor(role: string) {
    super("エージェントの定義の誤り");
    this.role = role;
  }
}

export function agentDefinitionPath(rootDir: string, role: PipelineRole): string {
  return join(rootDir, ".claude", "agents", `${role}.md`);
}

/** 定義の前置き(`---` で囲んだ部分)と本文に分ける。前置きがなければ null */
function splitDefinition(text: string): { front: string; body: string } | null {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  return match ? { front: match[1] as string, body: match[2] as string } : null;
}

/**
 * 定義から、モデルの完全な ID と、ハッシュを読む。ハッシュは、モデルの ID と指示の本文(前置きの外)から決める。
 * 名前や説明(description)の言い回しを直しただけでは、ハッシュは変わらない。
 */
export function parseAgentDefinition(role: PipelineRole, text: string): AgentStamp {
  const parts = splitDefinition(text);
  const model = parts ? /^model:\s*(\S+)\s*$/m.exec(parts.front)?.[1] : undefined;
  if (!parts || model === undefined) throw new AgentDefinitionError(role);
  const body = parts.body
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  return AgentStampSchema.parse({
    role,
    model,
    definitionHash: sha256(Buffer.from(`${model}\n${body}`)),
  });
}

/** リポジトリ直下(`rootDir`)の `.claude/agents/<役>.md` を読む */
export function readAgentStamp(rootDir: string, role: PipelineRole): AgentStamp {
  const path = agentDefinitionPath(rootDir, role);
  if (!existsSync(path)) throw new AgentDefinitionError(role);
  try {
    return parseAgentDefinition(role, readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof AgentDefinitionError) throw error;
    throw new AgentDefinitionError(role);
  }
}

/** 記録が現在の定義と同じか。記録がない古い結果は、同じとして扱う(定義を変えたときに、記録のあるものだけを出し直す) */
export function sameDefinition(recorded: AgentStamp | undefined, current: AgentStamp): boolean {
  return recorded === undefined || recorded.definitionHash === current.definitionHash;
}

/** 定義を読む。読めなければ、役の名前だけを報告して null(呼び出し側は、検査の失敗として止める) */
export function readAgentStampOrReport(output: Output, rootDir: string, role: PipelineRole): AgentStamp | null {
  try {
    return readAgentStamp(rootDir, role);
  } catch (error) {
    if (!(error instanceof AgentDefinitionError)) throw error;
    report(output, "エージェントの定義の誤り", error.role);
    return null;
  }
}
