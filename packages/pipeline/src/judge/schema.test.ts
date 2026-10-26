import { describe, expect, it } from "vitest";
import {
  JUDGE_CODES,
  JudgeEntrySchema,
  type JudgeFinding,
  JudgeOutputSchema,
  REWRITABLE_CODES,
  reasonsOf,
  UNPUBLISH_CODES,
  verdictProblem,
} from "./schema.ts";

const f = (code: (typeof JUDGE_CODES)[number], where = "explanation"): JudgeFinding => ({ code, where });

describe("判定と理由コードの組み合わせ", () => {
  it("publish_指摘がなければ通り_あれば止まる", () => {
    expect(verdictProblem("publish", [])).toBeNull();
    expect(verdictProblem("publish", [f("choices-weak", "choices.B")])).toBe("publish-with-findings");
  });

  it("rewritable_書き直しの理由だけを 1 つ以上持てば通る", () => {
    expect(verdictProblem("rewritable", [f("type-mismatch", "questionText")])).toBeNull();
    expect(verdictProblem("rewritable", [f("choices-weak", "choices.C"), f("explanation-inconsistent")])).toBeNull();
    expect(verdictProblem("rewritable", [])).toBe("rewritable-needs-finding");
    expect(verdictProblem("rewritable", [f("choices-weak", "choices.C"), f("not-unique", "questionText")])).toBe(
      "rewritable-with-unpublish-code",
    );
  });

  it("unpublish_書き直しでは直らない理由を持てば通り_書き直しの理由を併せ持ってもよい", () => {
    expect(verdictProblem("unpublish", [f("not-unique", "questionText")])).toBeNull();
    expect(
      verdictProblem("unpublish", [f("out-of-scope", "questionText"), f("situation-unnatural", "questionText")]),
    ).toBeNull();
    expect(verdictProblem("unpublish", [])).toBe("unpublish-needs-unpublish-code");
    expect(verdictProblem("unpublish", [f("type-mismatch", "questionText")])).toBe("unpublish-needs-unpublish-code");
  });

  it("理由コードの一覧_書き直しの理由と書き直せない理由が重ならず_すべてが一覧に入る", () => {
    expect(new Set(JUDGE_CODES).size).toBe(JUDGE_CODES.length);
    expect(JUDGE_CODES).toHaveLength(REWRITABLE_CODES.length + UNPUBLISH_CODES.length);
    for (const code of UNPUBLISH_CODES) expect((REWRITABLE_CODES as readonly string[]).includes(code)).toBe(false);
  });

  it("理由コードの結果_重複を除いて並びを固定し_judge: を付ける", () => {
    expect(
      reasonsOf([f("explanation-inconsistent"), f("choices-weak", "choices.A"), f("choices-weak", "choices.B")]),
    ).toEqual(["judge:choices-weak", "judge:explanation-inconsistent"]);
    expect(reasonsOf([])).toEqual([]);
  });
});

describe("判定役の出力の形", () => {
  const base = { examCode: "AWS-AIB-C01", requestKey: "a".repeat(16), questionId: "AIB-0001" };

  it("本文を持つ項目_形の検査で止まる(strict)", () => {
    expect(JudgeOutputSchema.safeParse({ ...base, verdict: "publish", findings: [] }).success).toBe(true);
    expect(JudgeOutputSchema.safeParse({ ...base, verdict: "publish", findings: [], note: "本文" }).success).toBe(
      false,
    );
    expect(
      JudgeOutputSchema.safeParse({
        ...base,
        verdict: "rewritable",
        findings: [{ code: "choices-weak", where: "choices.B", quote: "本文" }],
      }).success,
    ).toBe(false);
  });

  it("未知の判定・未知の理由コード・形の違う場所_止まる", () => {
    expect(JudgeOutputSchema.safeParse({ ...base, verdict: "hold", findings: [] }).success).toBe(false);
    expect(
      JudgeOutputSchema.safeParse({ ...base, verdict: "rewritable", findings: [{ code: "bad", where: "explanation" }] })
        .success,
    ).toBe(false);
    expect(
      JudgeOutputSchema.safeParse({
        ...base,
        verdict: "rewritable",
        findings: [{ code: "choices-weak", where: "choices.b" }],
      }).success,
    ).toBe(false);
  });

  it("判定の結果の 1 件_問題の ID は公開データの形で_本文の項目を持てない", () => {
    const entry = {
      questionId: "AIB-0001",
      contentHash: "a".repeat(64),
      criteriaHash: "b".repeat(64),
      verdict: "publish",
      reasons: [],
      findings: [],
      machine: { total: 100, lost: [], candidate: false },
      agent: { role: "question-judge", model: "claude-opus-5-5", definitionHash: "c".repeat(64) },
    };
    expect(JudgeEntrySchema.safeParse(entry).success).toBe(true);
    expect(JudgeEntrySchema.safeParse({ ...entry, questionId: "e-aaaaaaaaaaaa" }).success).toBe(false);
    expect(JudgeEntrySchema.safeParse({ ...entry, questionText: "本文" }).success).toBe(false);
  });
});
