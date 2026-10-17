import { z } from "zod";
import type { BodyCache } from "../collect/cache.ts";
import { sha256 } from "../collect/fetcher.ts";
import { type Draft, isChoiceDraft } from "../draft/schema.ts";
import type { FactsFile } from "../facts/schema.ts";
import { findSection } from "../facts/sections.ts";
import { AgentStampSchema } from "../shared/agents.ts";
import { EXPLANATION_CODES, JUDGEMENTS, WHERE } from "./schema.ts";

/** 依頼の形が変わったら上げる。鍵に入るので、上げると依頼のキャッシュが切れる */
export const VERIFY_REQUEST_VERSION = 1;

const KEY = z.string().regex(/^[0-9a-f]{16}$/);
const SectionSchema = z.strictObject({ heading: z.string().min(1), text: z.string().min(1) });
const ChoiceKey = z.string().regex(/^[A-Z]$/);

const common = {
  examCode: z.string().min(1),
  requestKey: KEY,
  draftId: z.string().regex(/^d-[0-9a-f]{12}$/),
  /** 根拠の節(見出しと本文)と下書きの内容のハッシュ。依頼のあとに節か下書きが変わったかを確かめる */
  evidenceHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** 根拠の節。事実カードの出典のアンカー(見出し)から、取得した本文を切り出したもの */
  sections: z.array(SectionSchema).min(1),
  outputPath: z.string().min(1),
  agent: AgentStampSchema,
};

/**
 * 再導出の依頼。載せるのは、設問文と選択肢(記号と文言)、根拠の節の本文だけ。
 * 正解、解説、誤答の設計、事実カードの主張(言い換え)は載せない(下書きの宣言に引きずられず、独立に導くため)。
 */
export const RederiveRequestSchema = z.strictObject({
  ...common,
  check: z.literal("rederive"),
  kind: z.enum(["single", "multiple"]),
  questionText: z.string().min(1),
  choices: z.array(z.strictObject({ key: ChoiceKey, text: z.string().min(1) })).min(2),
});

/** 解説の確認の依頼。再導出のあとの別の依頼で、正解と解説を載せる(再導出の独立を保つため、同じ依頼にしない) */
export const ExplanationRequestSchema = z.strictObject({
  ...common,
  check: z.literal("explanation"),
  questionText: z.string().min(1),
  choices: z.array(z.strictObject({ key: ChoiceKey, text: z.string().min(1) })).min(2),
  correctAnswers: z.array(ChoiceKey).min(1),
  explanation: z.string().min(1),
  choiceExplanations: z.array(z.strictObject({ key: ChoiceKey, text: z.string().min(1) })),
  distractorReasons: z.array(z.strictObject({ key: ChoiceKey, reason: z.string().min(1) })),
  /** 指摘できる場所 */
  locations: z.array(WHERE),
});

export const VerifyRequestSchema = z.discriminatedUnion("check", [RederiveRequestSchema, ExplanationRequestSchema]);
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type RederiveRequest = z.infer<typeof RederiveRequestSchema>;
export type ExplanationRequest = z.infer<typeof ExplanationRequestSchema>;

const outputCommon = { examCode: z.string().min(1), requestKey: z.string().min(1), draftId: z.string().min(1) };

/** 検証役が書く再導出の出力。判定のある選択肢には、根拠の節の見出しと、短い言い換えを付ける(本文の写しは持たない) */
export const RederiveOutputSchema = z.strictObject({
  ...outputCommon,
  check: z.literal("rederive"),
  judgements: z
    .array(
      z.strictObject({
        key: ChoiceKey,
        judgement: z.enum(JUDGEMENTS),
        evidence: z
          .strictObject({ heading: z.string().min(1).max(200), summary: z.string().min(1).max(200) })
          .nullable(),
      }),
    )
    .min(2)
    .max(10),
});

export const ExplanationOutputSchema = z.strictObject({
  ...outputCommon,
  check: z.literal("explanation"),
  findings: z.array(z.strictObject({ where: WHERE, code: z.enum(EXPLANATION_CODES) })).max(40),
});

export type RederiveOutput = z.infer<typeof RederiveOutputSchema>;
export type ExplanationOutput = z.infer<typeof ExplanationOutputSchema>;

export type EvidenceSection = z.infer<typeof SectionSchema>;

export type SectionProblem = "fact-not-found" | "body-not-cached" | "anchor-not-found";

/**
 * 下書きの根拠の節を取り出す。根拠の事実カードの最初の出典のアンカー(見出し)から、キャッシュの本文を切り出す。
 * 取り出せないとき(事実カードがない、本文がキャッシュにない、見出しが本文にない)は理由を返し、通す側に倒さない。
 */
export function collectSections(
  draft: Draft,
  facts: FactsFile,
  cache: BodyCache,
): { ok: true; sections: EvidenceSection[] } | { ok: false; reason: SectionProblem } {
  const sections: EvidenceSection[] = [];
  const seen = new Set<string>();
  for (const id of [...new Set(draft.factIds)].sort()) {
    const evidence = facts.cards.find((c) => c.id === id)?.sources[0];
    if (evidence === undefined) return { ok: false, reason: "fact-not-found" };
    const body = cache.read(evidence.contentHash);
    if (body === null) return { ok: false, reason: "body-not-cached" };
    const section = findSection(body.toString("utf8"), evidence.anchor.heading);
    if (section === null || section.text === "") return { ok: false, reason: "anchor-not-found" };
    const marker = `${evidence.contentHash}\n${evidence.anchor.heading}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    sections.push({ heading: evidence.anchor.heading, text: section.text });
  }
  return { ok: true, sections };
}

export function evidenceHash(sections: readonly EvidenceSection[], draft: Draft): string {
  return sha256(
    Buffer.from(
      JSON.stringify([
        sections.map((s) => [s.heading, s.text]),
        // 下書きの内容(設問文、選択肢、正解、解説、誤答の設計)。変わると、検証をやり直す
        draft,
      ]),
    ),
  );
}

/** 依頼の鍵。下書きの ID、検査の種類、根拠の節と下書きの内容のハッシュ、検証役の定義のハッシュから決まる。同じ入力は再び依頼しない */
export function verifyKey(
  check: "rederive" | "explanation",
  draftId: string,
  evidence: string,
  definitionHash: string,
): string {
  return sha256(Buffer.from(JSON.stringify([check, draftId, evidence, definitionHash, VERIFY_REQUEST_VERSION]))).slice(
    0,
    16,
  );
}

/** 写しの検査に使う、下書きの文章(設問文・選択肢・解説・誤答の理由・補足) */
export function draftTexts(draft: Draft): string[] {
  return [
    draft.questionText,
    draft.explanation,
    draft.supplement ?? "",
    ...(isChoiceDraft(draft)
      ? [
          ...draft.choices.flatMap((c) => [c.text, c.explanation ?? ""]),
          ...(draft.distractors ?? []).map((d) => d.reason),
        ]
      : []),
  ].filter((t) => t !== "");
}
