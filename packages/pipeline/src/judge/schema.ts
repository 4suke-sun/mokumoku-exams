import { z } from "zod";
import { QUESTION_ID } from "../contract.ts";
import { AgentStampSchema } from "../shared/agents.ts";

/**
 * 判定の段階(ADR 0021、docs/exam-style/README.md の「判定の基準」)。公開している選択式の問題 1 問を、判定役(question-judge)が、
 * 資格別の判定の基準(LLM の観点)に照らして、公開・書き直しで復帰できる・非公開のどれにするかを判定する。
 * 判定の結果は、問題の ID・判定・理由コード・指摘の場所・機械の観点の点数と減点の項目・各種ハッシュだけを持ち、本文の写しは持たない。
 */

export const JUDGE_VERDICTS = ["publish", "rewritable", "unpublish"] as const;
export type JudgeVerdict = (typeof JUDGE_VERDICTS)[number];

/** 書き直しで直せる理由。内容(論点)は生かせるが、書き方が基準を満たさない */
export const REWRITABLE_CODES = [
  /** J1: 設問の型が、その資格の型から外れる */
  "type-mismatch",
  /** J2: 状況が不自然、または要件が答えを分けていない */
  "situation-unnatural",
  /** J3: 誤答が紛らわしくない、または選択肢の構成がそろっていない */
  "choices-weak",
  /** J4: 解説が、設問・正解・選択肢と食い違う */
  "explanation-inconsistent",
] as const;

/** 同じ内容の書き直しでは直らない理由 */
export const UNPUBLISH_CODES = [
  /** J5: 正答が 1 つに決まらない(複数選択は個数も) */
  "not-unique",
  /** J5: 試験の範囲外の論点を問う */
  "out-of-scope",
] as const;

export const JUDGE_CODES = [...REWRITABLE_CODES, ...UNPUBLISH_CODES] as const;
export type JudgeCode = (typeof JUDGE_CODES)[number];

/** 理由コードを、結果に残す形にする */
export const judgeReason = (code: JudgeCode): string => `judge:${code}`;

/** 指摘の場所: 設問文、解説、選択肢(記号) */
export const JUDGE_WHERE = z.string().regex(/^(?:questionText|explanation|choices\.[A-Z])$/);

export const JudgeFindingSchema = z.strictObject({ code: z.enum(JUDGE_CODES), where: JUDGE_WHERE });
export type JudgeFinding = z.infer<typeof JudgeFindingSchema>;

const HASH = z.string().regex(/^[0-9a-f]{64}$/);

/** 判定役が書く出力。判定と、指摘(理由コードと場所)だけ。本文は書かない */
export const JudgeOutputSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().min(1),
  questionId: z.string().min(1),
  verdict: z.enum(JUDGE_VERDICTS),
  findings: z.array(JudgeFindingSchema).max(20),
});
export type JudgeOutput = z.infer<typeof JudgeOutputSchema>;

export type VerdictProblem =
  | "publish-with-findings"
  | "rewritable-needs-finding"
  | "rewritable-with-unpublish-code"
  | "unpublish-needs-unpublish-code";

const isUnpublishCode = (code: JudgeCode): boolean => (UNPUBLISH_CODES as readonly string[]).includes(code);

/**
 * 判定と理由コードの組み合わせの規則。publish は指摘を持たない。rewritable は書き直しの理由だけを 1 つ以上持つ。
 * unpublish は、書き直しでは直らない理由を 1 つ以上持つ(書き直しの理由を併せて持ってよい)。守れていれば null
 */
export function verdictProblem(verdict: JudgeVerdict, findings: readonly JudgeFinding[]): VerdictProblem | null {
  const codes = findings.map((f) => f.code);
  switch (verdict) {
    case "publish":
      return codes.length === 0 ? null : "publish-with-findings";
    case "rewritable":
      if (codes.length === 0) return "rewritable-needs-finding";
      return codes.some(isUnpublishCode) ? "rewritable-with-unpublish-code" : null;
    case "unpublish":
      return codes.some(isUnpublishCode) ? null : "unpublish-needs-unpublish-code";
  }
}

/** 理由コード(`judge:<コード>`)の一覧。重複なし、並びは固定 */
export function reasonsOf(findings: readonly JudgeFinding[]): string[] {
  return [...new Set(findings.map((f) => f.code))].sort().map(judgeReason);
}

/** 判定の結果の 1 件。機械の観点の点数(点数票)と、判定に使ったエージェントの定義を持つ。本文は持たない */
export const JudgeEntrySchema = z.strictObject({
  questionId: z.string().regex(QUESTION_ID),
  /** 問題の内容(設問文・選択肢・正解・解説)のハッシュ。問題が変わると、判定をやり直す */
  contentHash: HASH,
  /** 判定の基準(資格別の文書の節)のハッシュ。基準が変わると、判定をやり直す */
  criteriaHash: HASH,
  verdict: z.enum(JUDGE_VERDICTS),
  reasons: z.array(z.string().regex(/^judge:[a-z]+(?:-[a-z]+)*$/)).max(10),
  findings: z.array(JudgeFindingSchema).max(20),
  machine: z.strictObject({
    total: z.number().int().min(0).max(100),
    lost: z.array(z.string().regex(/^[A-Z]\d{1,2}$/)).max(20),
    /** 点数票で不合格(合格点に届かない、または止める項目に違反する) */
    candidate: z.boolean(),
  }),
  agent: AgentStampSchema,
});
export type JudgeEntry = z.infer<typeof JudgeEntrySchema>;

export const JudgeResultsSchema = z.strictObject({
  examCode: z.string().min(1),
  entries: z.array(JudgeEntrySchema),
});
export type JudgeResults = z.infer<typeof JudgeResultsSchema>;
