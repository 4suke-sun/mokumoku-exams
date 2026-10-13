import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { ChoiceQuestionSchema, normalizeText } from "../contract.ts";

/**
 * 選択式(単一・複数)の問題の下書き。エージェントが書く形。
 * 形の検査は緩くしておき(本文の URL などは、スタイル規則が止める)、データの契約との適合は、組み立てた問題で確かめる。
 */

export const FACT_ID = z.string().regex(/^f-[0-9a-f]{12}$/);

const text = (max: number) => z.string().max(max).regex(/\S/);

export const DraftChoiceSchema = z.strictObject({
  key: z.string().regex(/^[A-Z]$/),
  text: text(500),
  explanation: text(1000).optional(),
});

export const ChoiceDraftSchema = z.strictObject({
  questionType: z.enum(["single", "multiple"]),
  questionText: text(1000),
  choices: z.array(DraftChoiceSchema).min(2).max(10),
  correctAnswers: z
    .array(z.string().regex(/^[A-Z]$/))
    .min(1)
    .max(10),
  /** 総合解説。正答の理由を書く */
  explanation: text(3000),
  supplement: text(1000).optional(),
  /** 根拠にした事実カードの ID(1 つ以上)。設問文と正答は、この主張だけを根拠にする */
  factIds: z.array(FACT_ID).min(1).max(10),
});

export type ChoiceDraft = z.infer<typeof ChoiceDraftSchema>;

/** 下書きの識別子。出題計画の項目、根拠の事実カード、設問文から決まるので、同じ下書きなら同じ ID になる */
export function draftId(
  examCode: string,
  planItemId: string,
  factIds: readonly string[],
  questionText: string,
): string {
  const key = [examCode, planItemId, [...factIds].sort().join(","), normalizeText(questionText)].join("\n");
  return `d-${sha256(Buffer.from(key)).slice(0, 12)}`;
}

/** 下書きから、データの問題の形を組み立てる。ID は仮(書き出しの段階で採番する) */
export function assembleQuestion(
  draft: ChoiceDraft,
  context: {
    examCode: string;
    domain: string;
    difficulty: "easy" | "medium" | "hard";
    referenceUrls: readonly string[];
  },
): unknown {
  return {
    questionId: "DRAFT-0000",
    examCode: context.examCode,
    domain: context.domain,
    difficulty: context.difficulty,
    questionType: draft.questionType,
    questionText: draft.questionText,
    choices: draft.choices,
    correctAnswers: draft.correctAnswers,
    explanation: draft.explanation,
    ...(draft.supplement !== undefined ? { supplement: draft.supplement } : {}),
    ...(context.referenceUrls.length > 0 ? { references: context.referenceUrls.map((url) => ({ url })) } : {}),
  };
}

/** 組み立てた問題が、データの契約を通るか。通らなければ、問題の項目の場所(値は含めない)を返す */
export function schemaProblems(question: unknown): string[] {
  const parsed = ChoiceQuestionSchema.safeParse(question);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join(".") || "(全体)");
}
