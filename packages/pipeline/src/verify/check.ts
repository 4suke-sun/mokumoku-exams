import type { ChoiceDraft } from "../draft/schema.ts";
import type { AgentStamp } from "../shared/agents.ts";
import { detectCopy } from "../shared/copy.ts";
import type {
  EvidenceSection,
  ExplanationOutput,
  ExplanationRequest,
  RederiveOutput,
  RederiveRequest,
  VerifyRequest,
} from "./request.ts";
import type { Judgement, VerifyCode } from "./schema.ts";

/**
 * 検証の依頼の組み立てと、検証役の出力の照合。verify コマンドと、検証役の評価(eval コマンド)が同じ関数を使う。
 * モデルは呼ばない。
 */

/** 解説の確認で、指摘できる場所 */
export function explanationLocations(draft: ChoiceDraft): string[] {
  return [
    "explanation",
    ...draft.choices.flatMap((c) => (c.explanation !== undefined ? [`choices.${c.key}.explanation`] : [])),
    ...(draft.distractors ?? []).map((d) => `distractors.${d.key}.reason`),
  ];
}

/**
 * 検証の依頼を組み立てる。再導出の依頼には、設問文・選択肢・節だけを載せる(正解・解説・誤答の設計は載せない)。
 * 解説の確認の依頼は、再導出のあとの別の依頼で、正解と解説を載せる。
 */
export function buildVerifyRequest(input: {
  check: "rederive" | "explanation";
  examCode: string;
  key: string;
  draftId: string;
  draft: ChoiceDraft;
  sections: EvidenceSection[];
  evidence: string;
  outputPath: string;
  stamp: AgentStamp;
}): VerifyRequest {
  const { draft } = input;
  const base = {
    examCode: input.examCode,
    requestKey: input.key,
    draftId: input.draftId,
    evidenceHash: input.evidence,
    sections: input.sections,
    outputPath: input.outputPath,
    agent: input.stamp,
    questionText: draft.questionText,
    choices: draft.choices.map((c) => ({ key: c.key, text: c.text })),
  };
  if (input.check === "rederive") return { ...base, check: "rederive", kind: draft.questionType };
  return {
    ...base,
    check: "explanation",
    correctAnswers: draft.correctAnswers,
    explanation: draft.explanation,
    choiceExplanations: draft.choices.flatMap((c) =>
      c.explanation !== undefined ? [{ key: c.key, text: c.explanation }] : [],
    ),
    distractorReasons: (draft.distractors ?? []).map((d) => ({ key: d.key, reason: d.reason })),
    locations: explanationLocations(draft),
  };
}

/** 再導出の出力を、下書きの宣言と照合する */
export function judgeRederive(
  correct: readonly string[],
  judgements: readonly { key: string; judgement: Judgement; evidenceFound: boolean }[],
): { codes: VerifyCode[]; keys: string[] } {
  const codes: VerifyCode[] = [];
  for (const j of judgements) {
    const declared = correct.includes(j.key);
    if (j.judgement === "unknown") codes.push("undetermined");
    else if (declared && j.judgement === "incorrect") codes.push("answer-mismatch");
    else if (!declared && j.judgement === "correct") codes.push("distractor-correct");
    if (j.judgement !== "unknown" && !j.evidenceFound) codes.push("evidence-not-found");
  }
  return { codes: [...new Set(codes)].sort() as VerifyCode[], keys: judgements.map((j) => j.key) };
}

export type RederiveCheck =
  | { ok: false; reason: "request-mismatch" | "output-invalid" }
  | { ok: true; codes: VerifyCode[]; choices: { key: string; judgement: Judgement }[] };

/** 再導出の出力の検査と照合。依頼との一致、選択肢の過不足、根拠の言い換えが節の写しでないことを見てから、宣言と照合する */
export function checkRederiveOutput(
  request: RederiveRequest,
  out: RederiveOutput,
  correct: readonly string[],
): RederiveCheck {
  if (out.examCode !== request.examCode || out.requestKey !== request.requestKey || out.draftId !== request.draftId) {
    return { ok: false, reason: "request-mismatch" };
  }
  const requestKeys = request.choices.map((c) => c.key).sort();
  const outKeys = out.judgements.map((j) => j.key).sort();
  const sectionTexts = request.sections.map((s) => s.text);
  const summaryCopied = out.judgements.some(
    (j) => j.evidence !== null && detectCopy(j.evidence.summary, sectionTexts) !== null,
  );
  if (JSON.stringify(requestKeys) !== JSON.stringify(outKeys) || summaryCopied) {
    return { ok: false, reason: "output-invalid" };
  }
  const headings = new Set(request.sections.map((s) => s.heading));
  const judged = judgeRederive(
    correct,
    out.judgements.map((j) => ({
      key: j.key,
      judgement: j.judgement,
      evidenceFound: j.evidence !== null && headings.has(j.evidence.heading),
    })),
  );
  return {
    ok: true,
    codes: judged.codes,
    choices: [...out.judgements]
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map((j) => ({ key: j.key, judgement: j.judgement })),
  };
}

export type ExplanationCheck =
  | { ok: false; reason: "request-mismatch" | "output-invalid" }
  | { ok: true; findings: { where: string; code: VerifyCode }[] };

/** 解説の確認の出力の検査。指摘の場所が、依頼の locations にあることを見る */
export function checkExplanationOutput(request: ExplanationRequest, out: ExplanationOutput): ExplanationCheck {
  if (out.examCode !== request.examCode || out.requestKey !== request.requestKey || out.draftId !== request.draftId) {
    return { ok: false, reason: "request-mismatch" };
  }
  const allowed = new Set(request.locations);
  if (out.findings.some((f) => !allowed.has(f.where))) return { ok: false, reason: "output-invalid" };
  return {
    ok: true,
    findings: [...out.findings].sort((a, b) => (a.where + a.code < b.where + b.code ? -1 : 1)),
  };
}
