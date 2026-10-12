import { describe, expect, it } from "vitest";
import {
  answerFor,
  countPool,
  displayLabels,
  domainCounts,
  domainSelectHref,
  formatRemaining,
  isCorrect,
  isOfficialTarget,
  isQuestionCorrect,
  keyForLabel,
  labelKeys,
  newOfficialSession,
  newSession,
  orderChoices,
  passLinePercent,
  pickQuestions,
  relabelText,
  remainingMs,
  requestedDomains,
  score,
  sessionProgress,
  shuffle,
  shuffleChoiceOrder,
  sortKeys,
  textAnswerFor,
} from "./quiz.ts";
import type { ChoiceQuestion, FreeTextQuestion } from "./types.ts";

function question(id: number, domain: string, correct: string[]): ChoiceQuestion {
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
    expect(isCorrect(questions[0] as ChoiceQuestion, ["A"])).toBe(true);
    expect(isCorrect(questions[0] as ChoiceQuestion, ["B"])).toBe(false);
    expect(isCorrect(questions[0] as ChoiceQuestion, [])).toBe(false);
  });

  it("複数選択は、順序によらず、すべて選んだときだけ正解", () => {
    const q = questions[1] as ChoiceQuestion;
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

describe("自由記述の採点", () => {
  const freeText: FreeTextQuestion = {
    questionId: "TEST-0009",
    examCode: "TEST",
    domain: "domain1",
    questionType: "free-text",
    questionText: "記述の問題",
    rubric: { criteria: [{ name: "観点", keywords: ["保存"], points: 10 }], passingPoints: 10 },
    explanation: "解説",
  };

  it("採点基準の判定で合格点以上_正解。選択肢の回答は見ない", () => {
    expect(isQuestionCorrect(freeText, {}, { "TEST-0009": "保存する" })).toBe(true);
    expect(isQuestionCorrect(freeText, { "TEST-0009": ["A"] }, { "TEST-0009": "読む" })).toBe(false);
    expect(isQuestionCorrect(freeText, {}, undefined)).toBe(false);
  });

  it("選択式と自由記述が混ざった出題_両方を正答数に数える", () => {
    const mixed = [questions[0] as ChoiceQuestion, freeText];
    expect(score(mixed, { "TEST-0001": ["A"] }, { "TEST-0009": "保存" })).toEqual({
      total: 2,
      correct: 2,
      percent: 100,
    });
    expect(score(mixed, { "TEST-0001": ["A"] })).toEqual({ total: 2, correct: 1, percent: 50 });
  });

  it("自由記述の回答_空白だけは未回答として数える", () => {
    const progress = sessionProgress({
      questionIds: ["a", "b", "c"],
      answers: {},
      textAnswers: { a: "回答", b: "  " },
    });
    expect(progress).toEqual({ answered: 1, total: 3 });
  });

  it("継承されたプロパティ_自由記述の回答として扱わない", () => {
    expect(textAnswerFor({}, "constructor")).toBe("");
    expect(textAnswerFor(undefined, "a")).toBe("");
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
    const q = questions[1] as ChoiceQuestion;
    const ordered = orderChoices(q, order);
    expect([...ordered.map((c) => c.key)].sort()).toEqual(["A", "B", "C"]);
    expect(order[q.questionId]).not.toEqual(["A", "B", "C"]);
    expect(isCorrect(q, ["B", "C"])).toBe(true);
  });

  it("並びの保存なし_元の並びで返す", () => {
    const q = questions[0] as ChoiceQuestion;
    expect(orderChoices(q).map((c) => c.key)).toEqual(["A", "B", "C"]);
  });

  it("選択肢と食い違う並び_元の並びで返す", () => {
    const q = questions[0] as ChoiceQuestion;
    expect(orderChoices(q, { [q.questionId]: ["C", "B", "X"] }).map((c) => c.key)).toEqual(["A", "B", "C"]);
    expect(orderChoices(q, { [q.questionId]: ["C", "C", "B"] }).map((c) => c.key)).toEqual(["A", "B", "C"]);
    expect(orderChoices(q, { [q.questionId]: ["C", "B"] }).map((c) => c.key)).toEqual(["A", "B", "C"]);
  });

  it("保存した並び_その順で返す", () => {
    const q = questions[0] as ChoiceQuestion;
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

describe("分野を選んだ状態のモード選択", () => {
  const codes = ["domain1", "domain2"];

  it("経路の分野_資格の分野なら選び_読み戻すと同じ分野になる", () => {
    const href = domainSelectHref("EX-SMP-XX", "domain2");
    expect(href).toBe("/exams/EX-SMP-XX?domain=domain2");
    expect(requestedDomains(new URL(href, "http://localhost").search, codes)).toEqual(["domain2"]);
  });

  it("指定がない・資格の分野でない_何も選ばない", () => {
    for (const search of ["", "?domain=", "?domain=domain9", "?other=domain1", "?domain=DOMAIN1"]) {
      expect(requestedDomains(search, codes), search).toEqual([]);
    }
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
    expect(isCorrect(questions[1] as ChoiceQuestion, ["A", "B"])).toBe(false);
  });

  it("同じキーを重ねて選んでも_重複は 1 つとして扱う", () => {
    expect(isCorrect(questions[0] as ChoiceQuestion, ["A", "A"])).toBe(true);
    expect(isCorrect(questions[1] as ChoiceQuestion, ["B", "B"])).toBe(false);
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
    expect(score([questions[0] as ChoiceQuestion], { "OTHER-0001": ["A"] })).toEqual({
      total: 1,
      correct: 0,
      percent: 0,
    });
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

describe("newSession", () => {
  const items = [
    { questionId: "Q-2", choiceKeys: ["A", "B", "C"] },
    { questionId: "Q-1", choiceKeys: ["A", "B"] },
  ];
  const now = new Date(Date.UTC(2026, 9, 11, 0, 0));

  it("渡した順に出題し_回答なし・最初の問題から始める", () => {
    expect(newSession("EX-SMP-XX", items, { shuffleChoices: false }, Math.random, now)).toEqual({
      examCode: "EX-SMP-XX",
      questionIds: ["Q-2", "Q-1"],
      answers: {},
      index: 0,
      startedAt: "2026-10-11T00:00:00.000Z",
      choiceOrder: undefined,
    });
  });

  it("選択肢をシャッフルする_問題ごとに並びを決める", () => {
    const session = newSession("EX-SMP-XX", items, { shuffleChoices: true }, () => 0, now);
    expect(Object.keys(session.choiceOrder ?? {}).sort()).toEqual(["Q-1", "Q-2"]);
    expect([...(session.choiceOrder?.["Q-2"] ?? [])].sort()).toEqual(["A", "B", "C"]);
  });
});

describe("本番モード", () => {
  const exam = { examCode: "TEST", officialQuestionCount: 3, officialTimeMinutes: 10 };
  const items = ["1", "2", "3", "4", "5"].map((n) => ({
    questionId: `TEST-000${n}`,
    questionType: "single" as const,
    choiceKeys: ["A", "B"],
  }));
  const start = new Date("2026-10-10T00:00:00.000Z");

  it("本番の問題数を重複なく選び_開始の時刻から制限時間後を締め切りにする", () => {
    const session = newOfficialSession(exam, items, { shuffleChoices: false }, seeded(1), start);
    expect(session.questionIds).toHaveLength(3);
    expect(new Set(session.questionIds).size).toBe(3);
    expect(session.startedAt).toBe("2026-10-10T00:00:00.000Z");
    expect(session.deadline).toBe("2026-10-10T00:10:00.000Z");
    expect(session.choiceOrder).toBeUndefined();
  });

  it("自由記述を含む問題データ_選択式の問題だけから出題する", () => {
    const freeText = ["6", "7", "8"].map((n) => ({
      questionId: `TEST-000${n}`,
      questionType: "free-text" as const,
      choiceKeys: [],
    }));
    const multiple = { questionId: "TEST-0009", questionType: "multiple" as const, choiceKeys: ["A", "B", "C"] };
    // 選択式は 2 問だけ。本番の問題数(3)に足りなくても、自由記述で埋めない
    const mixed = [freeText[0], items[0], freeText[1], multiple, freeText[2]].filter((i) => i !== undefined);
    for (let seed = 1; seed <= 20; seed++) {
      const session = newOfficialSession(exam, mixed, { shuffleChoices: false }, seeded(seed), start);
      expect([...session.questionIds].sort()).toEqual(["TEST-0001", "TEST-0009"]);
    }
  });

  it("選択式かどうか_択一と複数選択だけが本番モードの対象", () => {
    expect(isOfficialTarget({ questionType: "single" })).toBe(true);
    expect(isOfficialTarget({ questionType: "multiple" })).toBe(true);
    expect(isOfficialTarget({ questionType: "free-text" })).toBe(false);
  });

  it("問題が本番の問題数より少ない_ある分だけを出題する", () => {
    const session = newOfficialSession(exam, items.slice(0, 2), { shuffleChoices: true }, seeded(2), start);
    expect(session.questionIds).toHaveLength(2);
    expect(Object.keys(session.choiceOrder ?? {})).toHaveLength(2);
  });

  it("残り時間_締め切りまでの差で_過ぎたら 0", () => {
    const deadline = "2026-10-10T00:10:00.000Z";
    expect(remainingMs(deadline, start)).toBe(600_000);
    expect(remainingMs(deadline, new Date("2026-10-10T00:09:59.500Z"))).toBe(500);
    expect(remainingMs(deadline, new Date("2026-10-10T00:10:00.000Z"))).toBe(0);
    expect(remainingMs(deadline, new Date("2026-10-10T00:11:00.000Z"))).toBe(0);
  });

  it("締め切りの値が読めない_時間切れとして扱う", () => {
    expect(remainingMs("not-a-date", start)).toBe(0);
  });

  it("残り時間の表示_分と秒で_1 秒未満は切り上げる", () => {
    expect(formatRemaining(600_000)).toBe("10:00");
    expect(formatRemaining(61_000)).toBe("1:01");
    expect(formatRemaining(500)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5)).toBe("0:00");
  });
});

describe("表示用の記号", () => {
  // シャッフルで C, A, B の順に並んだ選択肢
  const labels = displayLabels([{ key: "C" }, { key: "A" }, { key: "B" }]);

  it("並べた順に_上から_A_B_C_を振る", () => {
    expect([...labels]).toEqual([
      ["C", "A"],
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  it("押された記号から_元のキーを引ける", () => {
    expect(keyForLabel(labels, "A")).toBe("C");
    expect(keyForLabel(labels, "Z")).toBeUndefined();
  });

  it("元のキーの並びを_表示用の記号にして記号の順に並べる", () => {
    expect(labelKeys(["A", "C"], labels)).toEqual(["A", "B"]);
  });

  it("解説の中の選択肢の記号を_表示用の記号に置き換える", () => {
    expect(relabelText("## 正解がAである理由は\n選択肢Cは誤り。B と（A）も参照。", labels)).toBe(
      "## 正解がBである理由は\n選択肢Aは誤り。C と（B）も参照。",
    );
  });

  it("英数字につながる大文字と_選択肢にない記号は_置き換えない", () => {
    expect(relabelText("AI と Amazon S3、トップP", labels)).toBe("AI と Amazon S3、トップP");
  });

  it("並びが元のままなら_文章を変えない", () => {
    const same = displayLabels([{ key: "A" }, { key: "B" }]);
    expect(relabelText("選択肢Bは正しい", same)).toBe("選択肢Bは正しい");
  });
});
