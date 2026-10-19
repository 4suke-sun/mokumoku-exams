import { describe, expect, it } from "vitest";
import { passedSectionCount, sectionPassLine, sectionStatus, sectionsOf, sectionTargets } from "./sections.ts";

describe("sectionsOf", () => {
  it("5 問ずつに分ける", () => {
    expect(sectionsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
    ]);
  });

  it("5 の倍数でない_最後のセクションは少ない問題数のまま", () => {
    expect(sectionsOf([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
    expect(sectionsOf([])).toEqual([]);
  });
});

describe("sectionTargets", () => {
  it("自由記述を含む問題_選択式だけをデータの並びのまま残す", () => {
    const items = [
      { questionId: "Q1", questionType: "single" as const },
      { questionId: "Q2", questionType: "free-text" as const },
      { questionId: "Q3", questionType: "multiple" as const },
    ];
    expect(sectionTargets(items).map((q) => q.questionId)).toEqual(["Q1", "Q3"]);
  });

  it("選択式 6 問と自由記述 1 問_自由記述を除いて 5 問と 1 問に分ける", () => {
    const items = ["single", "single", "free-text", "multiple", "single", "single", "single"].map((type, i) => ({
      questionId: `Q${i + 1}`,
      questionType: type as "single" | "multiple" | "free-text",
    }));
    expect(sectionsOf(sectionTargets(items).map((q) => q.questionId))).toEqual([
      ["Q1", "Q2", "Q4", "Q5", "Q6"],
      ["Q7"],
    ]);
  });
});

describe("sectionPassLine", () => {
  it.each([
    [5, 4],
    [4, 4],
    [3, 3],
    [2, 2],
    [1, 1],
  ])("%i 問_%i 問で合格(8 割の切り上げ)", (total, line) => {
    expect(sectionPassLine(total)).toBe(line);
  });
});

describe("sectionStatus", () => {
  it("満点・合格・未達・未挑戦", () => {
    expect(sectionStatus({ correct: 5, total: 5 })).toBe("perfect");
    expect(sectionStatus({ correct: 4, total: 5 })).toBe("passed");
    expect(sectionStatus({ correct: 3, total: 5 })).toBe("failed");
    expect(sectionStatus({ correct: 2, total: 2 })).toBe("perfect");
    expect(sectionStatus({ correct: 1, total: 2 })).toBe("failed");
    expect(sectionStatus(undefined)).toBe("untried");
  });

  it("合格したセクションの数_満点を含め_範囲の外は数えない", () => {
    const at = "2026-10-12T00:00:00.000Z";
    const best = {
      "0": { correct: 5, total: 5, finishedAt: at },
      "1": { correct: 4, total: 5, finishedAt: at },
      "2": { correct: 1, total: 5, finishedAt: at },
      "9": { correct: 5, total: 5, finishedAt: at },
    };
    expect(passedSectionCount(best, 3)).toBe(2);
  });
});
