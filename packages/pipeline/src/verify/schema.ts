import { z } from "zod";
import { AgentStampSchema } from "../shared/agents.ts";

/**
 * 検証の段階(ADR 0007・0009)。作る役(question-drafter)とは別の検証役が、根拠にした出典の節だけを読み、
 * 選択肢ごとの正誤を再導出して、下書きが宣言した正解と照合する。解説は、再導出のあとの別の依頼で確かめる。
 * 記録(verification)は、判定・理由コード・検査ごとの結果だけを持ち、本文の写しは持たない。
 */

/** 検証の理由コード。一覧はここだけに持ち、未定義のコードは取り込みで拒否する */
export const VERIFY_CODES = [
  /** 宣言した正解の選択肢が、節では正しくない */
  "answer-mismatch",
  /** 誤答とした選択肢が、節では正しい */
  "distractor-correct",
  /** 節だけでは判定できない選択肢がある */
  "undetermined",
  /** 判定の根拠が節に見つからない */
  "evidence-not-found",
  /** 解説が節と食い違う */
  "explanation-conflict",
  /** 誤答の理由が誤り */
  "reason-wrong",
  /** 適用範囲や条件を超えた、強すぎる断定がある */
  "overclaim",
  /** 自由記述の下書きは、再導出の形では検証できない。人が確かめる */
  "free-text-unchecked",
  /** 根拠の節の本文の写し(依頼を出す前に落とす) */
  "copy",
] as const;

export type VerifyCode = (typeof VERIFY_CODES)[number];

/** 解説の確認で指摘できる理由コード */
export const EXPLANATION_CODES = ["explanation-conflict", "reason-wrong", "overclaim"] as const;

export const VERDICTS = ["pass", "hold", "reject"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** 判定の重さ。複数の理由があるときは、重い判定(不採用、保留、合格の順)を採る */
const WEIGHT: Record<Verdict, number> = { pass: 0, hold: 1, reject: 2 };
export function heavier(a: Verdict, b: Verdict): Verdict {
  return WEIGHT[a] >= WEIGHT[b] ? a : b;
}

/** 理由コードを、下書きの状態(reasons)に残す形にする */
export const verifyReason = (code: VerifyCode): string => `verify:${code}`;

export const JUDGEMENTS = ["correct", "incorrect", "unknown"] as const;
export type Judgement = (typeof JUDGEMENTS)[number];

/** 指摘の場所: 総合解説、選択肢ごとの解説、誤答の理由、選択肢 */
export const WHERE = z.string().regex(/^(?:explanation|choices\.[A-Z](?:\.explanation)?|distractors\.[A-Z]\.reason)$/);

export const VerificationSchema = z.strictObject({
  /** 判定。null は途中(再導出は合格で、解説の確認がまだ) */
  verdict: z.enum(VERDICTS).nullable(),
  /** 理由コード(`verify:<コード>`、重複なし) */
  reasons: z.array(z.string().regex(/^verify:[a-z]+(?:-[a-z]+)*$/)).max(20),
  /** 解説などの指摘の場所 */
  findings: z.array(z.strictObject({ code: z.enum(VERIFY_CODES), where: WHERE })).max(40),
  checks: z.strictObject({
    /** 再導出。選択肢ごとの判定の分布を残す */
    rederive: z
      .strictObject({
        result: z.enum(["pass", "hold"]),
        choices: z.array(z.strictObject({ key: z.string().regex(/^[A-Z]$/), judgement: z.enum(JUDGEMENTS) })).max(10),
      })
      .optional(),
    explanation: z.strictObject({ result: z.enum(["pass", "hold"]) }).optional(),
    copy: z.strictObject({ result: z.enum(["pass", "reject"]) }).optional(),
  }),
  /** 根拠の節(見出しと本文)と下書きの内容のハッシュ。節か下書きが変わると、検証をやり直す */
  evidenceHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  /** 検証に使ったエージェントの定義(役・モデルの ID・定義のハッシュ) */
  agent: AgentStampSchema.optional(),
});

export type Verification = z.infer<typeof VerificationSchema>;

/** 書き出しの条件: 検証を通った合格。検証が保留でも、人が承認していれば通す(人の判断を優先する) */
export function isVerified(
  verification: Verification | undefined,
  decision: "approve" | "release" | "reject" | undefined,
): boolean {
  if (verification === undefined) return false;
  if (verification.verdict === "pass") return true;
  return verification.verdict === "hold" && decision === "approve";
}
