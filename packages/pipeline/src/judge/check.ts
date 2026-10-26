import type { JudgeRequest } from "./request.ts";
import { type JudgeOutput, verdictProblem } from "./schema.ts";

export type JudgeCheck = { ok: true } | { ok: false; reason: string };

/**
 * 判定役の出力を、依頼と照合する。形の検査(JudgeOutputSchema)に通ったあとに行う。
 * 依頼との ID の一致、指摘の場所が依頼にあること、判定と理由コードの組み合わせの規則を確かめる。失敗の理由は、場所と種類だけ。
 */
export function checkJudgeOutput(request: JudgeRequest, output: JudgeOutput): JudgeCheck {
  if (
    output.examCode !== request.examCode ||
    output.requestKey !== request.requestKey ||
    output.questionId !== request.questionId
  ) {
    return { ok: false, reason: "id-mismatch" };
  }
  const known = new Set(request.locations);
  if (output.findings.some((f) => !known.has(f.where))) return { ok: false, reason: "location-unknown" };
  const problem = verdictProblem(output.verdict, output.findings);
  return problem === null ? { ok: true } : { ok: false, reason: problem };
}
