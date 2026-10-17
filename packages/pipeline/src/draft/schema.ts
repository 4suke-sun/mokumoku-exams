import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import {
  ChoiceQuestionSchema,
  CRITERION_NAME_MAX,
  FreeTextQuestionSchema,
  KEYWORD_MAX,
  normalizeText,
} from "../contract.ts";

/**
 * 選択式(単一・複数)の問題の下書き。エージェントが書く形。
 * 上限は、データの契約が持つものはその値を使い(観点名とキーワード)、二重に持たない。データの契約にない上限(設問文、総合解説、
 * 選択肢、補足、誤答の理由、適用範囲の言い表し)は、下書きだけの上限としてここで持つ(docs/drafting.md)。
 * 形の検査を通っても、組み立てた問題がデータの検査に落ちることはありうる。その下書きだけを不採用にし、同じ出力の他の下書きは取り込む。
 */

export const FACT_ID = z.string().regex(/^f-[0-9a-f]{12}$/);

const text = (max: number) => z.string().max(max).regex(/\S/);

export const DraftChoiceSchema = z.strictObject({
  key: z.string().regex(/^[A-Z]$/),
  text: text(500),
  explanation: text(1000).optional(),
});

/** 誤答の型。誤答が「たまたま間違い」ではなく、根拠のある誤りになるようにする */
export const DISTRACTOR_TYPES = [
  "similar-service",
  "scope-difference",
  "misconception",
  "numeric-difference",
  "condition-reversal",
] as const;

export type DistractorType = (typeof DISTRACTOR_TYPES)[number];

/** 誤答 1 つの設計: なぜ誤りか、その根拠(事実カードの主張か、適用範囲の違い) */
export const DistractorSchema = z.strictObject({
  /** 選択肢の key。正答でない選択肢に 1 つずつ */
  key: z.string().regex(/^[A-Z]$/),
  type: z.enum(DISTRACTOR_TYPES),
  /** 誤りである理由 */
  reason: text(500),
  basis: z.union([
    z.strictObject({ factId: FACT_ID }),
    /** 適用範囲の違い(版、リージョン、条件)を短く言い表す。type が scope-difference のときだけ */
    z.strictObject({ scope: text(100) }),
  ]),
});

export type Distractor = z.infer<typeof DistractorSchema>;

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
  /** 誤答の設計。形は任意にしてあり、正答でない選択肢ごとにあるかは検査(distractors.ts)で確かめる */
  distractors: z.array(DistractorSchema).max(10).optional(),
});

export type ChoiceDraft = z.infer<typeof ChoiceDraftSchema>;

/** 採点基準の観点。回答がキーワードのどれかを含めば、観点を満たし、配点を得る */
export const DraftCriterionSchema = z.strictObject({
  name: text(CRITERION_NAME_MAX),
  keywords: z.array(text(KEYWORD_MAX)).min(1).max(20),
  points: z.number().int().min(1).max(1000),
});

/** 自由記述の問題の下書き。選択肢はなく、採点基準(rubric)を持つ。形はデータの仕様(docs/data-spec.md の「自由記述」)に合わせる */
export const FreeTextDraftSchema = z.strictObject({
  questionType: z.literal("free-text"),
  questionText: text(1000),
  rubric: z.strictObject({
    criteria: z.array(DraftCriterionSchema).min(1).max(10),
    passingPoints: z.number().int().min(1).max(10000),
  }),
  /** 総合解説。解答の例を含めてよい */
  explanation: text(3000),
  supplement: text(1000).optional(),
  /** 根拠にした事実カードの ID(1 つ以上)。観点とキーワードは、この主張だけを根拠にする */
  factIds: z.array(FACT_ID).min(1).max(10),
});

export type FreeTextDraft = z.infer<typeof FreeTextDraftSchema>;

/** 下書き: 選択式(単一・複数)か、自由記述 */
export const DraftSchema = z.union([ChoiceDraftSchema, FreeTextDraftSchema]);
export type Draft = ChoiceDraft | FreeTextDraft;

export function isChoiceDraft(draft: Draft): draft is ChoiceDraft {
  return draft.questionType !== "free-text";
}

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
  draft: Draft,
  context: {
    examCode: string;
    domain: string;
    difficulty: "easy" | "medium" | "hard";
    referenceUrls: readonly string[];
  },
): unknown {
  const common = {
    questionId: "DRAFT-0000",
    examCode: context.examCode,
    domain: context.domain,
    difficulty: context.difficulty,
    questionType: draft.questionType,
    questionText: draft.questionText,
    explanation: draft.explanation,
    ...(draft.supplement !== undefined ? { supplement: draft.supplement } : {}),
    ...(context.referenceUrls.length > 0 ? { references: context.referenceUrls.map((url) => ({ url })) } : {}),
  };
  if (!isChoiceDraft(draft)) return { ...common, rubric: draft.rubric };
  // 誤答の選択肢の解説は、誤答の設計の理由を使う(選択肢に解説が書かれていれば、それを優先する)
  const choices = draft.choices.map((c) => {
    if (c.explanation !== undefined) return c;
    const reason = draft.distractors?.find((d) => d.key === c.key)?.reason;
    return reason !== undefined ? { ...c, explanation: reason } : c;
  });
  return { ...common, choices, correctAnswers: draft.correctAnswers };
}

/** 組み立てた問題が、データの契約を通るか。通らなければ、問題の項目の場所(値は含めない)を返す */
export function schemaProblems(question: unknown): string[] {
  const isFreeText = (question as { questionType?: unknown }).questionType === "free-text";
  const parsed = (isFreeText ? FreeTextQuestionSchema : ChoiceQuestionSchema).safeParse(question);
  return parsed.success ? [] : parsed.error.issues.map((i) => i.path.join(".") || "(全体)");
}
