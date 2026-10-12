import { describe, expect, it } from "vitest";
import { recentMarks, statsFromResults } from "./question-stats.ts";
import type { Result } from "./storage.ts";
import type { Question } from "./types.ts";

const question = { questionId: "T-0001", questionType: "single", correctAnswers: ["A"] } as unknown as Question;

const result = (minute: number, answer: string): Result => ({
  examCode: "T",
  questionIds: ["T-0001", "T-9999"],
  answers: { "T-0001": [answer] },
  finishedAt: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
});

describe("statsFromResults", () => {
  it("回数を数え_直近の正誤を古い順に 5 回分_データにない問題は含めない", () => {
    // 新しい順に並んだ結果(端末の保存の並び)
    const results = [6, 5, 4, 3, 2, 1, 0].map((m) => result(m, m % 2 === 0 ? "A" : "B"));
    const stats = statsFromResults(results, [question]);
    expect(stats.get("T-0001")).toEqual({ count: 7, recent: [true, false, true, false, true] });
    expect(stats.has("T-9999")).toBe(false);
  });
});

describe("recentMarks", () => {
  it("足りない分は左を - で埋め_右が最新", () => {
    expect(recentMarks([true, false])).toEqual(["-", "-", "-", "o", "x"]);
    expect(recentMarks([])).toEqual(["-", "-", "-", "-", "-"]);
    expect(recentMarks([true, true, false, false, true, true])).toEqual(["o", "x", "x", "o", "o"]);
  });
});
