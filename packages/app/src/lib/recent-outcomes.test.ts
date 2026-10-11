import { describe, expect, it } from "vitest";
import { recentOutcomes } from "./recent-outcomes.ts";
import type { Result } from "./storage.ts";
import type { Question } from "./types.ts";

const question = (n: number): Question =>
  ({
    questionId: `SAMPLE-000${n}`,
    examCode: "SAMPLE",
    domain: "domain1",
    questionType: "single",
    questionText: "問題",
    choices: [
      { key: "A", text: "a" },
      { key: "B", text: "b" },
    ],
    correctAnswers: ["A"],
    explanation: "解説",
  }) as Question;

const questions = [question(1), question(2)];

const result = (minute: number, answers: Record<string, string[]>, ids = Object.keys(answers)): Result => ({
  examCode: "SAMPLE",
  questionIds: ids,
  answers,
  finishedAt: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
});

describe("問題ごとの直近の正誤", () => {
  it("結果がない_どの問題も記録なし", () => {
    expect(recentOutcomes([], questions).size).toBe(0);
  });

  it("新しい順に_出題された回だけを並べる", () => {
    const results = [
      result(3, { "SAMPLE-0001": ["A"] }),
      result(2, { "SAMPLE-0001": ["B"], "SAMPLE-0002": ["A"] }),
      result(1, { "SAMPLE-0001": ["A"] }),
    ];
    const outcomes = recentOutcomes(results, questions);
    expect(outcomes.get("SAMPLE-0001")).toEqual([true, false, true]);
    expect(outcomes.get("SAMPLE-0002")).toEqual([true]);
  });

  it("6 回以上解いた問題_新しい 5 回だけを返す", () => {
    const results = [9, 8, 7, 6, 5, 4, 3].map((minute) =>
      result(minute, { "SAMPLE-0001": minute === 3 || minute === 4 ? ["B"] : ["A"] }),
    );
    expect(recentOutcomes(results, questions).get("SAMPLE-0001")).toEqual([true, true, true, true, true]);
  });

  it("上限を変える_その回数までにする", () => {
    const results = [result(2, { "SAMPLE-0001": ["A"] }), result(1, { "SAMPLE-0001": ["B"] })];
    expect(recentOutcomes(results, questions, 1).get("SAMPLE-0001")).toEqual([true]);
  });

  it("未回答は不正解_いまのデータにない問題は含めない", () => {
    const outcomes = recentOutcomes([result(1, {}, ["SAMPLE-0001", "SAMPLE-0099"])], questions);
    expect(outcomes.get("SAMPLE-0001")).toEqual([false]);
    expect(outcomes.has("SAMPLE-0099")).toBe(false);
  });

  it("1 つの結果に同じ問題が重なる_1 回として数える", () => {
    const outcomes = recentOutcomes([result(1, { "SAMPLE-0001": ["A"] }, ["SAMPLE-0001", "SAMPLE-0001"])], questions);
    expect(outcomes.get("SAMPLE-0001")).toEqual([true]);
  });
});
