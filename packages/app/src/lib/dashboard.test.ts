import { describe, expect, it } from "vitest";
import { summarize } from "./dashboard.ts";
import type { Result } from "./storage.ts";
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
