import { describe, expect, it } from "vitest";
import { attemptDomains, averageTimeMs, domainBreakdown, PREDICTION_WINDOW, summarize } from "./dashboard.ts";
import { mergeResults } from "./history/merge.ts";
import { MAX_RESULTS, type Result } from "./storage.ts";
import type { Question } from "./types.ts";

const question = (n: number, correctAnswers = ["A"]): Question =>
  ({
    questionId: `SAMPLE-000${n}`,
    examCode: "SAMPLE",
    domain: "domain1",
    questionType: "single",
    difficulty: "easy",
    questionText: "問題",
    choices: [
      { key: "A", text: "a" },
      { key: "B", text: "b" },
    ],
    correctAnswers,
    explanation: "解説",
  }) as Question;

const questions = [question(1), question(2), question(3), question(4)];
const exam = { passingScore: 70, totalScore: 100 };

const result = (minute: number, answers: Record<string, string[]>, ids = Object.keys(answers)): Result => ({
  examCode: "SAMPLE",
  questionIds: ids,
  answers,
  finishedAt: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
});

describe("学習の状況のまとめ", () => {
  it("結果がない_回数は 0 で_合格予測は出さない", () => {
    const summary = summarize([], questions, exam);
    expect(summary).toMatchObject({ attempts: 0, answered: 0, percent: 0, distinct: 0, totalQuestions: 4 });
    expect(summary.prediction).toBeNull();
  });

  it("分野の重みがない資格_直近の結果の全体の正答率を_合格ラインと比べる", () => {
    const results = [
      // 2 問中 2 問(100%)
      result(2, { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["A"] }),
      // 4 問中 1 問(25%)。未回答は不正解
      result(1, { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["B"] }, [
        "SAMPLE-0001",
        "SAMPLE-0002",
        "SAMPLE-0003",
        "SAMPLE-0004",
      ]),
    ];
    const summary = summarize(results, questions, exam);
    expect(summary.prediction).toEqual({
      percent: 50,
      passLine: 70,
      reached: false,
      gap: 20,
      basedOn: 2,
      domains: [],
      priorities: [],
    });
    expect(summary).toMatchObject({ attempts: 2, answered: 6, correct: 3, percent: 50, distinct: 4 });
    expect(summary.recent.map((r) => r.percent)).toEqual([100, 25]);
  });

  it("平均が合格ラインちょうど_届いているとみなす", () => {
    const answers = { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["A"], "SAMPLE-0003": ["A"], "SAMPLE-0004": ["B"] };
    const summary = summarize([result(1, answers)], questions, { passingScore: 750, totalScore: 1000 });
    expect(summary.prediction).toMatchObject({ percent: 75, passLine: 75, reached: true, gap: 0 });
  });

  it("いまのデータにない問題_数えず_数える問題がない結果は回数にも入れない", () => {
    const results = [result(2, { "SAMPLE-0099": ["A"] }), result(1, { "SAMPLE-0001": ["A"], "SAMPLE-0099": ["A"] })];
    const summary = summarize(results, questions, exam);
    expect(summary).toMatchObject({ attempts: 1, answered: 1, correct: 1, distinct: 1 });
  });
});

// 合格予測の境界。問題の ID は 4 桁、分野は指定できるようにする
const q = (n: number, domain = "domain1"): Question => ({
  ...question(1),
  questionId: `SAMPLE-${String(n).padStart(4, "0")}`,
  domain,
});
const many = Array.from({ length: 10 }, (_, i) => q(i + 1));
/** 先頭の `total` 問を出題し、そのうち先頭の `correct` 問に正解した結果 */
const attempt = (minute: number, total: number, correct: number): Result => {
  const ids = many.slice(0, total).map((x) => x.questionId);
  return result(minute, Object.fromEntries(ids.slice(0, correct).map((id) => [id, ["A"]])), ids);
};

describe("合格予測の境界", () => {
  it("結果が 1 件_その回の正答率がそのまま予測になる", () => {
    const summary = summarize([attempt(1, 4, 3)], many, exam);
    expect(summary.prediction).toEqual({
      percent: 75,
      passLine: 70,
      reached: true,
      gap: 0,
      basedOn: 1,
      domains: [],
      priorities: [],
    });
  });

  it("結果が上限の 10 件_10 件すべてで平均する", () => {
    // 正解が 0〜9 問(10 問中)の 10 回。平均は 45%
    const results = Array.from({ length: 10 }, (_, i) => attempt(10 - i, 10, i));
    const summary = summarize(results, many, exam);
    expect(summary.prediction).toMatchObject({ percent: 45, basedOn: 10, reached: false });
    expect(summary.attempts).toBe(10);
  });

  it("10 回を超える結果_合格予測は新しい 10 回だけで見て_古い結果は平均に入らない", () => {
    // いちばん古い 1 回だけ 0%、ほかの 10 回は 100%
    const results = [attempt(0, 2, 0), ...Array.from({ length: 10 }, (_, i) => attempt(i + 1, 2, 2))];
    const merged = mergeResults(results, []);
    expect(merged.length).toBeLessThanOrEqual(MAX_RESULTS);
    const summary = summarize(merged, many, exam);
    expect(summary.prediction).toMatchObject({ percent: 100, basedOn: PREDICTION_WINDOW });
    // 延べの数は、すべての結果で数える
    expect(summary.attempts).toBe(11);
  });

  it("回ごとの問題数が大きく偏る_問題ごとに数えるので_延べの正答率と同じになる", () => {
    // 1 問中 1 問(100%)と、10 問中 0 問(0%)
    const summary = summarize([attempt(2, 1, 1), attempt(1, 10, 0)], many, exam);
    expect(summary.prediction).toMatchObject({ percent: 9.1, reached: false, basedOn: 2 });
    expect(summary).toMatchObject({ answered: 11, correct: 1, percent: 9.1 });
  });

  it("割り切れない合格ライン_丸めた値が平均と同じなら届いているとみなす", () => {
    // 合格ラインは 2/3 で 66.7%。3 問中 2 問(66.7%)
    const summary = summarize([attempt(1, 3, 2)], many, { passingScore: 2, totalScore: 3 });
    expect(summary.prediction).toMatchObject({ percent: 66.7, passLine: 66.7, reached: true });
  });

  it("平均が合格ラインにわずかに届かない_届いていないとみなす", () => {
    // 合格ラインは 70.1%。10 問中 7 問(70%)
    const summary = summarize([attempt(1, 10, 7)], many, { passingScore: 701, totalScore: 1000 });
    expect(summary.prediction).toMatchObject({ percent: 70, passLine: 70.1, reached: false });
  });
});

// 分野の配点で重み付けした予測。4 分野(重み 0.4 / 0.3 / 0.2 / 0.1)、各分野に 2 問
const weighted = ["domain1", "domain2", "domain3", "domain4"].flatMap((domain, d) => [
  q(d * 2 + 1, domain),
  q(d * 2 + 2, domain),
]);
const weights = [
  { code: "domain1", weight: 0.4 },
  { code: "domain2", weight: 0.3 },
  { code: "domain3", weight: 0.2 },
  { code: "domain4", weight: 0.1 },
];
const weightedExam = { passingScore: 70, totalScore: 100, domains: weights };
/** 指定した問題 ID に正解し、ほかの出題は誤答にした結果(`times` があれば、全問の回答時間) */
const solved = (minute: number, asked: number[], right: number[], times?: number[]): Result => ({
  ...result(
    minute,
    Object.fromEntries(right.map((n) => [`SAMPLE-${String(n).padStart(4, "0")}`, ["A"]])),
    asked.map((n) => `SAMPLE-${String(n).padStart(4, "0")}`),
  ),
  ...(times ? { timesMs: times } : {}),
});

describe("配点で重み付けした合格予測", () => {
  it("分野ごとに出題がある_重みで平均する(単純平均とは別の値になる)", () => {
    // 分野 1 は 100%、分野 2 は 50%、分野 3 は 0%、分野 4 は 100%。 0.4×100 + 0.3×50 + 0 + 0.1×100 = 65
    const results = [solved(1, [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 7, 8])];
    const prediction = summarize(results, weighted, weightedExam).prediction;
    expect(prediction).toMatchObject({ percent: 65, reached: false, gap: 5, passLine: 70 });
    // 単純な正答率は 5/8 = 62.5%
    expect(summarize(results, weighted, weightedExam).percent).toBe(62.5);
  });

  it("出題のない分野がある_全体の正答率で代用し_代用したと分かるようにする", () => {
    // 分野 1 の 2 問に 1 問正解(全体も 50%)。ほかの分野は出題なし → すべて 50%
    const prediction = summarize([solved(1, [1, 2], [1])], weighted, weightedExam).prediction;
    expect(prediction?.percent).toBe(50);
    expect(prediction?.priorities.map((p) => [p.domain, p.substituted])).toEqual([
      ["domain1", false],
      ["domain2", true],
      ["domain3", true],
    ]);
  });

  it("合格ラインちょうど_届いているとみなし_差は 0", () => {
    // 分野 1 と 2 が 100%、分野 3 が 0%、分野 4 が 100%。 0.4 + 0.3 + 0.1 = 80% → 合格ラインを 80% にする
    const results = [solved(1, [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 7, 8])];
    const prediction = summarize(results, weighted, { ...weightedExam, passingScore: 80 }).prediction;
    expect(prediction).toMatchObject({ percent: 80, passLine: 80, reached: true, gap: 0 });
  });

  it("重みの合計が 1 でない_合計で割って正規化する", () => {
    const doubled = { ...weightedExam, domains: weights.map((w) => ({ ...w, weight: w.weight * 2 })) };
    const results = [solved(1, [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 7, 8])];
    expect(summarize(results, weighted, doubled).prediction?.percent).toBe(65);
  });

  it("重みがすべて 0_全体の正答率にする", () => {
    const zero = { ...weightedExam, domains: weights.map((w) => ({ ...w, weight: 0 })) };
    const results = [solved(1, [1, 2, 3, 4], [1, 2, 3])];
    expect(summarize(results, weighted, zero).prediction).toMatchObject({ percent: 75, priorities: [] });
  });

  it("優先して復習したい分野_取りこぼしの大きい順(同じなら正答率の低い順)に 3 件まで", () => {
    // 分野 1: 50%(取りこぼし 0.4×50=20)、分野 2: 0%(30)、分野 3: 0%(20)、分野 4: 100%(0)
    const results = [solved(1, [1, 2, 3, 4, 5, 6, 7, 8], [1, 7, 8])];
    const { priorities } = summarize(results, weighted, weightedExam).prediction ?? { priorities: [] };
    expect(priorities.map((p) => [p.domain, p.loss, p.belowLine])).toEqual([
      ["domain2", 30, true],
      ["domain3", 20, true],
      ["domain1", 20, true],
    ]);
  });

  it("合格ライン以上の分野_優先の一覧に出しても_下の印は付けない", () => {
    const results = [solved(1, [1, 2, 3, 4], [1, 2, 3])];
    const { priorities } = summarize(results, weighted, { ...weightedExam, passingScore: 50 }).prediction ?? {
      priorities: [],
    };
    expect(priorities.find((p) => p.domain === "domain2")).toMatchObject({ percent: 50, belowLine: false });
  });

  it("分野ごとの平均回答時間_記録のある問題だけで平均し_記録がなければ null", () => {
    const results = [solved(1, [1, 2, 3, 4], [1, 2, 3, 4], [1000, 3000, 5000, 7000])];
    const rows = summarize(results, weighted, weightedExam).prediction?.domains ?? [];
    const time = (code: string) => rows.find((p) => p.domain === code)?.avgTimeMs;
    expect(time("domain1")).toBe(2000);
    expect(time("domain2")).toBe(6000);
    const none = summarize([solved(1, [1, 2], [1])], weighted, weightedExam).prediction?.domains ?? [];
    expect(none.map((p) => p.avgTimeMs)).toEqual([null, null, null, null]);
  });
});

describe("1 回の結果の分野ごとの集計", () => {
  it("分野の並びで返し_出題のない分野は含めず_平均回答時間を出す", () => {
    const rows = attemptDomains(solved(1, [1, 2, 5], [1, 5], [2000, 4000, 6000]), weighted, weights);
    expect(rows).toEqual([
      { domain: "domain1", answered: 2, correct: 1, percent: 50, avgTimeMs: 3000 },
      { domain: "domain3", answered: 1, correct: 1, percent: 100, avgTimeMs: 6000 },
    ]);
  });

  it("回答時間のない古い結果_平均回答時間は null", () => {
    expect(attemptDomains(solved(1, [1], [1]), weighted, weights)[0]?.avgTimeMs).toBeNull();
    expect(averageTimeMs({})).toBeNull();
    expect(averageTimeMs({ timesMs: [1000, 2000, 4000] })).toBe(2333);
  });
});

describe("分野別の正答率", () => {
  const mixed = [q(1, "domain1"), q(2, "domain1"), q(3, "domain2"), q(4, "domain2"), q(5, "domain3"), q(6, "domain4")];

  it("結果がない_分野を出さない", () => {
    expect(domainBreakdown([], mixed)).toEqual([]);
  });

  it("正答率の低い順に並べ_未回答は不正解とし_解いていない分野は出さない", () => {
    const results = [
      result(2, { "SAMPLE-0001": ["A"], "SAMPLE-0003": ["B"], "SAMPLE-0005": ["A"] }, [
        "SAMPLE-0001",
        "SAMPLE-0002",
        "SAMPLE-0003",
        "SAMPLE-0005",
      ]),
      result(1, { "SAMPLE-0001": ["A"], "SAMPLE-0004": ["A"] }),
    ];
    expect(domainBreakdown(results, mixed)).toEqual([
      { domain: "domain2", answered: 2, correct: 1, percent: 50 },
      { domain: "domain1", answered: 3, correct: 2, percent: 66.7 },
      { domain: "domain3", answered: 1, correct: 1, percent: 100 },
    ]);
  });

  it("正答率が同じ_解いた数の多い分野を先に_それも同じなら分野コードの順", () => {
    const results = [
      result(1, { "SAMPLE-0001": ["B"], "SAMPLE-0002": ["B"], "SAMPLE-0005": ["B"], "SAMPLE-0006": ["B"] }),
      result(2, { "SAMPLE-0003": ["B"] }),
    ];
    expect(domainBreakdown(results, mixed).map((d) => d.domain)).toEqual(["domain1", "domain2", "domain3", "domain4"]);
  });

  it("いまのデータにない問題_どの分野にも数えない", () => {
    const results = [result(1, { "SAMPLE-0099": ["A"], "SAMPLE-0005": ["B"] })];
    expect(domainBreakdown(results, mixed)).toEqual([{ domain: "domain3", answered: 1, correct: 0, percent: 0 }]);
  });

  it("自由記述の問題_採点基準の判定で正解に数える", () => {
    const freeText = {
      questionId: "SAMPLE-0009",
      examCode: "SAMPLE",
      domain: "domain2",
      questionType: "free-text",
      questionText: "記述",
      rubric: { criteria: [{ name: "観点", keywords: ["止まれ"], points: 10 }], passingPoints: 10 },
      explanation: "解説",
    } as Question;
    const written = (minute: number, text: string): Result => ({
      ...result(minute, {}, ["SAMPLE-0009"]),
      textAnswers: { "SAMPLE-0009": text },
    });
    expect(domainBreakdown([written(2, "赤は止まれ"), written(1, "赤は進め")], [freeText])).toEqual([
      { domain: "domain2", answered: 2, correct: 1, percent: 50 },
    ]);
  });
});
