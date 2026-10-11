import { describe, expect, it } from "vitest";
import { domainBreakdown, summarize } from "./dashboard.ts";
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

  it("回ごとの正答率の平均を_合格ラインと比べる(問題数で重み付けしない)", () => {
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
    expect(summary.prediction).toEqual({ averagePercent: 62.5, passLine: 70, reached: false, basedOn: 2 });
    expect(summary).toMatchObject({ attempts: 2, answered: 6, correct: 3, percent: 50, distinct: 4 });
    expect(summary.recent.map((r) => r.percent)).toEqual([100, 25]);
  });

  it("平均が合格ラインちょうど_届いているとみなす", () => {
    const answers = { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["A"], "SAMPLE-0003": ["A"], "SAMPLE-0004": ["B"] };
    const summary = summarize([result(1, answers)], questions, { passingScore: 750, totalScore: 1000 });
    expect(summary.prediction).toMatchObject({ averagePercent: 75, passLine: 75, reached: true });
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
  it("結果が 1 件_その回の正答率がそのまま平均になる", () => {
    const summary = summarize([attempt(1, 4, 3)], many, exam);
    expect(summary.prediction).toEqual({ averagePercent: 75, passLine: 70, reached: true, basedOn: 1 });
  });

  it("結果が上限の 10 件_10 件すべてで平均する", () => {
    // 正解が 0〜9 問(10 問中)の 10 回。平均は 45%
    const results = Array.from({ length: 10 }, (_, i) => attempt(10 - i, 10, i));
    const summary = summarize(results, many, exam);
    expect(summary.prediction).toMatchObject({ averagePercent: 45, basedOn: 10, reached: false });
    expect(summary.attempts).toBe(10);
  });

  it("上限を超える結果_まとめる前に新しい 10 件に切り詰められ_古い結果は平均に入らない", () => {
    // いちばん古い 1 回だけ 0%、ほかの 10 回は 100%
    const results = [attempt(0, 2, 0), ...Array.from({ length: 10 }, (_, i) => attempt(i + 1, 2, 2))];
    const merged = mergeResults(results, []);
    expect(merged).toHaveLength(MAX_RESULTS);
    expect(summarize(merged, many, exam).prediction).toMatchObject({ averagePercent: 100, basedOn: 10 });
  });

  it("回ごとの問題数が大きく偏る_問題数で重み付けせず_延べの正答率とは別に出す", () => {
    // 1 問中 1 問(100%)と、10 問中 0 問(0%)
    const summary = summarize([attempt(2, 1, 1), attempt(1, 10, 0)], many, exam);
    expect(summary.prediction).toMatchObject({ averagePercent: 50, reached: false, basedOn: 2 });
    expect(summary).toMatchObject({ answered: 11, correct: 1, percent: 9.1 });
  });

  it("割り切れない合格ライン_丸めた値が平均と同じなら届いているとみなす", () => {
    // 合格ラインは 2/3 で 66.7%。3 問中 2 問(66.7%)
    const summary = summarize([attempt(1, 3, 2)], many, { passingScore: 2, totalScore: 3 });
    expect(summary.prediction).toMatchObject({ averagePercent: 66.7, passLine: 66.7, reached: true });
  });

  it("平均が合格ラインにわずかに届かない_届いていないとみなす", () => {
    // 合格ラインは 70.1%。10 問中 7 問(70%)
    const summary = summarize([attempt(1, 10, 7)], many, { passingScore: 701, totalScore: 1000 });
    expect(summary.prediction).toMatchObject({ averagePercent: 70, passLine: 70.1, reached: false });
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
