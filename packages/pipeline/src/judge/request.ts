import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { type AgentStamp, AgentStampSchema } from "../shared/agents.ts";
import type { Criteria } from "./criteria.ts";
import { contentHash, type JudgeInput, locationsOf } from "./input.ts";

/** 依頼の形が変わったら上げる。鍵に入るので、上げると依頼のキャッシュが切れる */
export const JUDGE_REQUEST_VERSION = 1;

const KEY = z.string().regex(/^[0-9a-f]{16}$/);
const HASH = z.string().regex(/^[0-9a-f]{64}$/);
const ChoiceKey = z.string().regex(/^[A-Z]$/);

/** 判定の依頼。問題 1 問の内容と、機械の観点の結果(点数と減点の項目)と、判定の基準の節の本文を載せる。出典の節は載せない(ADR 0021) */
export const JudgeRequestSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: KEY,
  /** 公開している問題の ID、または評価用の事例の ID */
  questionId: z.string().min(1),
  contentHash: HASH,
  criteriaHash: HASH,
  kind: z.enum(["single", "multiple"]),
  questionText: z.string().min(1),
  choices: z.array(z.strictObject({ key: ChoiceKey, text: z.string().min(1) })).min(2),
  correctAnswers: z.array(ChoiceKey).min(1),
  explanation: z.string().min(1),
  /** 機械の観点(点数票)。点数票で不合格(合格点に届かない、または止める項目に違反する)ものは候補 */
  machine: z.strictObject({
    total: z.number().int().min(0).max(100),
    lost: z.array(z.string().regex(/^[A-Z]\d{1,2}$/)).max(20),
    candidate: z.boolean(),
  }),
  criteria: z.strictObject({ path: z.string().min(1), text: z.string().min(1) }),
  /** 指摘できる場所 */
  locations: z.array(z.string().min(1)).min(3),
  outputPath: z.string().min(1),
  agent: AgentStampSchema,
});
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;

/** 依頼の鍵。問題の内容、判定の基準、判定役の定義から決まる。同じ入力は再び依頼しない */
export function judgeKey(input: JudgeInput, criteria: Criteria, definitionHash: string): string {
  return sha256(
    Buffer.from(
      JSON.stringify([input.questionId, contentHash(input), criteria.hash, definitionHash, JUDGE_REQUEST_VERSION]),
    ),
  ).slice(0, 16);
}

export function buildJudgeRequest(args: {
  examCode: string;
  key: string;
  input: JudgeInput;
  criteria: Criteria;
  machine: { total: number; lost: readonly string[]; candidate: boolean };
  outputPath: string;
  stamp: AgentStamp;
}): JudgeRequest {
  const { input } = args;
  return {
    examCode: args.examCode,
    requestKey: args.key,
    questionId: input.questionId,
    contentHash: contentHash(input),
    criteriaHash: args.criteria.hash,
    kind: input.kind,
    questionText: input.questionText,
    choices: input.choices,
    correctAnswers: input.correctAnswers,
    explanation: input.explanation,
    machine: { total: args.machine.total, lost: [...args.machine.lost], candidate: args.machine.candidate },
    criteria: { path: args.criteria.path, text: args.criteria.text },
    locations: locationsOf(input),
    outputPath: args.outputPath,
    agent: args.stamp,
  };
}
