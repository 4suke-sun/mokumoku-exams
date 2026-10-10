import { describe, expect, it } from "vitest";
import { answerFor, countPool, isCorrect, passLinePercent, pickQuestions, score, shuffle, sortKeys } from "./quiz.ts";
import type { Question } from "./types.ts";

function question(id: number, domain: string, correct: string[]): Question {
  return {
    questionId: `TEST-${String(id).padStart(4, "0")}`,
    examCode: "TEST",
    domain,
    questionType: correct.length === 1 ? "single" : "multiple",
    questionText: `問題 ${id}`,
    choices: [
      { key: "A", text: "選択肢 1" },
      { key: "B", text: "選択肢 2" },
      { key: "C", text: "選択肢 3" },
    ],
    correctAnswers: correct,
    explanation: "解説",
  };
}

const questions = [
  question(1, "domain1", ["A"]),
  question(2, "domain1", ["B", "C"]),
  question(3, "domain2", ["C"]),
  question(4, "domain2", ["A"]),
];

// 先頭から順に選ばれる乱数(shuffle が元の並びを保つ)
const noShuffle = () => 0.999999;

describe("isCorrect", () => {
  it("択一は、正解の 1 つだけを選んだときに正解", () => {
    expect(isCorrect(questions[0] as Question, ["A"])).toBe(true);
    expect(isCorrect(questions[0] as Question, ["B"])).toBe(false);
    expect(isCorrect(questions[0] as Question, [])).toBe(false);
  });

  it("複数選択は、順序によらず、すべて選んだときだけ正解", () => {
    const q = questions[1] as Question;
    expect(isCorrect(q, ["C", "B"])).toBe(true);
    expect(isCorrect(q, ["B"])).toBe(false);
    expect(isCorrect(q, ["A", "B", "C"])).toBe(false);
  });
});

describe("answerFor", () => {
  it("回答がなければ空を返し、継承されたプロパティは回答として扱わない", () => {
    expect(answerFor({ "TEST-0001": ["A"] }, "TEST-0001")).toEqual(["A"]);
    expect(answerFor({}, "TEST-0001")).toEqual([]);
    expect(answerFor({}, "constructor")).toEqual([]);
  });
});

describe("shuffle", () => {
  it("元の配列を変えず、同じ要素を返す", () => {
    const source = [1, 2, 3, 4, 5];
    const result = shuffle(source, () => 0.3);
    expect(source).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("乱数が同じなら、結果も同じ", () => {
    expect(shuffle([1, 2, 3, 4], () => 0.5)).toEqual(shuffle([1, 2, 3, 4], () => 0.5));
  });
});

describe("pickQuestions / countPool", () => {
  it("分野を指定しないと、全分野から選ぶ", () => {
    expect(pickQuestions(questions, { count: 4, domains: [] }, noShuffle)).toHaveLength(4);
    expect(countPool(questions, [])).toBe(4);
  });

  it("分野で絞り込む", () => {
    const picked = pickQuestions(questions, { count: 10, domains: ["domain2"] }, noShuffle);
    expect(picked.map((q) => q.domain)).toEqual(["domain2", "domain2"]);
    expect(countPool(questions, ["domain2"])).toBe(2);
  });

  it("出題数が多すぎるときは、出題できる数に切り詰める", () => {
    expect(pickQuestions(questions, { count: 100, domains: [] }, noShuffle)).toHaveLength(4);
  });

  it("出題数が 0 以下なら、空になる", () => {
    expect(pickQuestions(questions, { count: 0, domains: [] }, noShuffle)).toEqual([]);
    expect(pickQuestions(questions, { count: -3, domains: [] }, noShuffle)).toEqual([]);
  });
});

describe("score", () => {
  it("正答数 ÷ 出題数 × 100 を返す。未回答は不正解", () => {
    const result = score(questions, { "TEST-0001": ["A"], "TEST-0002": ["B", "C"], "TEST-0003": ["A"] });
    expect(result).toEqual({ total: 4, correct: 2, percent: 50 });
  });

  it("出題が 0 問なら 0%", () => {
    expect(score([], {})).toEqual({ total: 0, correct: 0, percent: 0 });
  });
});

describe("passLinePercent", () => {
  it("合格点を満点で割った割合を返す", () => {
    expect(passLinePercent({ passingScore: 70, totalScore: 100 })).toBe(70);
    expect(passLinePercent({ passingScore: 700, totalScore: 1000 })).toBe(70);
  });
});

describe("sortKeys", () => {
  it("キーを昇順にそろえる", () => {
    expect(sortKeys(["C", "A", "B"])).toEqual(["A", "B", "C"]);
  });
});
