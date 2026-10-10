import { describe, expect, it } from "vitest";
import {
  answerFor,
  countPool,
  domainCounts,
  isCorrect,
  orderChoices,
  passLinePercent,
  pickQuestions,
  score,
  sessionProgress,
  shuffle,
  shuffleChoiceOrder,
  sortKeys,
} from "./quiz.ts";
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

describe("shuffleChoiceOrder / orderChoices", () => {
  it("シャッフルした並び_選択肢の集合は変わらず採点も変わらない", () => {
    const order = shuffleChoiceOrder(
      questions.map((x) => ({ questionId: x.questionId, choiceKeys: x.choices.map((c) => c.key) })),
      () => 0,
    );
    const q = questions[1] as Question;
    const ordered = orderChoices(q, order);
    expect([...ordered.map((c) => c.key)].sort()).toEqual(["A", "B", "C"]);
    expect(order[q.questionId]).not.toEqual(["A", "B", "C"]);
    expect(isCorrect(q, ["B", "C"])).toBe(true);
  });

  it("並びの保存なし_元の並びで返す", () => {
    const q = questions[0] as Question;
    expect(orderChoices(q).map((c) => c.key)).toEqual(["A", "B", "C"]);
  });

  it("選択肢と食い違う並び_元の並びで返す", () => {
    const q = questions[0] as Question;
    expect(orderChoices(q, { [q.questionId]: ["C", "B", "X"] }).map((c) => c.key)).toEqual(["A", "B", "C"]);
    expect(orderChoices(q, { [q.questionId]: ["C", "C", "B"] }).map((c) => c.key)).toEqual(["A", "B", "C"]);
    expect(orderChoices(q, { [q.questionId]: ["C", "B"] }).map((c) => c.key)).toEqual(["A", "B", "C"]);
  });

  it("保存した並び_その順で返す", () => {
    const q = questions[0] as Question;
    expect(orderChoices(q, { [q.questionId]: ["C", "A", "B"] }).map((c) => c.key)).toEqual(["C", "A", "B"]);
  });
});

describe("sessionProgress", () => {
  it("一部だけ回答_回答済みの数と出題数を返す", () => {
    const progress = sessionProgress({ questionIds: ["a", "b", "c"], answers: { a: ["A"], b: [] } });
    expect(progress).toEqual({ answered: 1, total: 3 });
  });
});

describe("domainCounts", () => {
  it("分野ごと_問題数を数える", () => {
    expect(domainCounts(questions)).toEqual({ domain1: 2, domain2: 2 });
  });
});

// 固定の種から決まった列を返す簡易な乱数(LCG)。シャッフルの性質を、複数の並びで確かめるために使う
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("isCorrect の境界", () => {
  it("同じ数でも正解と違う組み合わせ_不正解", () => {
    expect(isCorrect(questions[1] as Question, ["A", "B"])).toBe(false);
  });

  it("同じキーを重ねて選んでも_重複は 1 つとして扱う", () => {
    expect(isCorrect(questions[0] as Question, ["A", "A"])).toBe(true);
    expect(isCorrect(questions[1] as Question, ["B", "B"])).toBe(false);
  });
});

describe("shuffle の性質", () => {
  it("どの種でも_同じ要素の並べ替えになり_元の配列は変わらない", () => {
    const items = [1, 2, 3, 4, 5, 6];
    for (let seed = 1; seed <= 20; seed++) {
      const result = shuffle(items, seeded(seed));
      expect([...result].sort()).toEqual(items);
      expect(items).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it("空と 1 つだけの配列_そのまま返す", () => {
    expect(shuffle([], seeded(1))).toEqual([]);
    expect(shuffle([7], seeded(1))).toEqual([7]);
  });

  it("種を変えると_並びも変わる", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const orders = new Set(Array.from({ length: 10 }, (_, i) => shuffle(items, seeded(i + 1)).join(",")));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("pickQuestions の境界", () => {
  it("複数の分野を指定_その分野の問題だけから選ぶ", () => {
    const picked = pickQuestions(questions, { count: 4, domains: ["domain1", "domain2"] }, noShuffle);
    expect(picked).toHaveLength(4);
  });

  it("存在しない分野だけ_空になる", () => {
    expect(pickQuestions(questions, { count: 3, domains: ["none"] }, noShuffle)).toEqual([]);
    expect(countPool(questions, ["none"])).toBe(0);
  });

  it("選ばれた問題は_重複しない", () => {
    const picked = pickQuestions(questions, { count: 4, domains: [] }, seeded(3));
    expect(new Set(picked.map((q) => q.questionId)).size).toBe(4);
  });

  it("出題数と同数の問題がある_すべてを選ぶ", () => {
    const picked = pickQuestions(questions, { count: 2, domains: ["domain1"] }, noShuffle);
    expect(picked.map((q) => q.domain)).toEqual(["domain1", "domain1"]);
  });
});

describe("score / passLinePercent の端", () => {
  it("割り切れない割合_小数第 1 位に丸める", () => {
    const three = questions.slice(0, 3);
    expect(score(three, { [three[0]?.questionId as string]: ["A"] })).toEqual({ total: 3, correct: 1, percent: 33.3 });
    expect(
      score(three, { [three[0]?.questionId as string]: ["A"], [three[2]?.questionId as string]: ["C"] }).percent,
    ).toBe(66.7);
  });

  it("全問正解と全問不正解_100% と 0%", () => {
    const all = Object.fromEntries(questions.map((q) => [q.questionId, [...q.correctAnswers]]));
    expect(score(questions, all).percent).toBe(100);
    expect(score(questions, {}).percent).toBe(0);
  });

  it("出題にない問題の回答_数えない", () => {
    expect(score([questions[0] as Question], { "OTHER-0001": ["A"] })).toEqual({ total: 1, correct: 0, percent: 0 });
  });

  it("合格ラインが割り切れない_小数第 1 位に丸める", () => {
    expect(passLinePercent({ passingScore: 720, totalScore: 1000 })).toBe(72);
    expect(passLinePercent({ passingScore: 2, totalScore: 3 })).toBe(66.7);
  });
});

describe("集計の端", () => {
  it("回答が 1 つもない_回答済みは 0", () => {
    expect(sessionProgress({ questionIds: ["a", "b"], answers: {} })).toEqual({ answered: 0, total: 2 });
  });

  it("問題がない_分野別の数も空", () => {
    expect(domainCounts([])).toEqual({});
  });
});
