import { describe, expect, it } from "vitest";
import {
  type BiasQuestion,
  checkAnswerBias,
  isBiased,
  LONGEST_CORRECT_MAX,
  letterStats,
  longestCorrect,
  MIN_BIAS_QUESTIONS,
} from "./bias.ts";

const KEYS = ["A", "B", "C", "D"];

/** 択一の問題。`longest` の記号の選択肢だけを長くする(省くと、どれも同じ長さ) */
const single = (answer: string, longest?: string): BiasQuestion => ({
  questionType: "single",
  choices: KEYS.map((key) => ({ key, text: key === longest ? "長い選択肢の文" : "短い文" })),
  correctAnswers: [answer],
});

/** 正解の記号を、A から順に均等に回した択一の問題 */
const balanced = (count: number) => Array.from({ length: count }, (_, i) => single(KEYS[i % 4] ?? "A"));

describe("正解の記号の偏り", () => {
  it("記号が均等_偏りとしない", () => {
    expect(checkAnswerBias("q.json", balanced(40))).toEqual({ errors: [], warnings: [] });
  });

  it("正解が A に寄っている_その記号を失敗として報告し_本文は出さない", () => {
    const questions = [...Array.from({ length: 20 }, () => single("A")), ...balanced(20)];
    const { errors } = checkAnswerBias("q.json", questions);
    // A は 25 問(期待値 10)。ほかの記号の 5 問は、ずれが標準偏差の 3 倍に届かないので偏りとしない
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("q.json: 択一の正解の記号 A");
    expect(errors.join("\n")).not.toContain("選択肢の文");
  });

  it("問題数が下限より少ない_偏っていても検査しない", () => {
    const few = Array.from({ length: MIN_BIAS_QUESTIONS - 1 }, () => single("A"));
    expect(checkAnswerBias("q.json", few)).toEqual({ errors: [], warnings: [] });
    const enough = Array.from({ length: MIN_BIAS_QUESTIONS }, () => single("A"));
    expect(checkAnswerBias("q.json", enough).errors.length).toBeGreaterThan(0);
  });

  it("ずれの判定_標準偏差の 3 倍と期待値の 40% の両方を超えたときだけ偏りとする", () => {
    // 期待値 25、標準偏差 sqrt(100 × 0.25 × 0.75) ≒ 4.33。3 倍は約 13、期待値の 40% は 10
    expect(isBiased({ letter: "A", observed: 37, expected: 25, sigma: Math.sqrt(18.75) })).toBe(false);
    expect(isBiased({ letter: "A", observed: 39, expected: 25, sigma: Math.sqrt(18.75) })).toBe(true);
    // 期待値が小さいと、40% のほうが効く
    expect(isBiased({ letter: "A", observed: 3, expected: 1, sigma: 0.5 })).toBe(true);
    expect(isBiased({ letter: "A", observed: 1.3, expected: 1, sigma: 0.05 })).toBe(false);
  });

  it("複数選択_問題ごとの正解の数と選択肢の数から期待値を数える", () => {
    const multiple: BiasQuestion = {
      questionType: "multiple",
      choices: ["A", "B", "C", "D", "E"].map((key) => ({ key, text: key })),
      correctAnswers: ["B", "E"],
    };
    const [a, b] = letterStats([multiple, multiple]);
    expect(a).toMatchObject({ letter: "A", observed: 0, expected: 0.8 });
    expect(b).toMatchObject({ letter: "B", observed: 2, expected: 0.8 });
  });
});

describe("最長の選択肢が正解", () => {
  it("最長がただ 1 つで正解_数え_最長が並ぶ問題は数えない", () => {
    const tie: BiasQuestion = {
      questionType: "single",
      choices: [
        { key: "A", text: "同じ長さ" },
        { key: "B", text: "同じ長さ" },
        { key: "C", text: "短" },
      ],
      correctAnswers: ["A"],
    };
    expect(longestCorrect([single("A", "A"), single("B", "A"), tie])).toEqual({ count: 1, total: 3 });
  });

  it("割合が上限を超える_警告にし_失敗にはしない", () => {
    const over = Math.floor(40 * LONGEST_CORRECT_MAX) + 1;
    const questions = balanced(40).map((q, i) =>
      i < over ? single(q.correctAnswers?.[0] ?? "A", q.correctAnswers?.[0]) : q,
    );
    const { errors, warnings } = checkAnswerBias("q.json", questions);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("最長の選択肢が正解");
  });

  it("割合が上限ちょうど_警告にしない", () => {
    const at = Math.floor(40 * LONGEST_CORRECT_MAX);
    const questions = balanced(40).map((q, i) =>
      i < at ? single(q.correctAnswers?.[0] ?? "A", q.correctAnswers?.[0]) : q,
    );
    expect(checkAnswerBias("q.json", questions).warnings).toEqual([]);
  });
});
