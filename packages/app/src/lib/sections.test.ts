import { describe, expect, it } from "vitest";
import { passedSectionCount, sectionPassLine, sectionStatus, sectionsOf } from "./sections.ts";

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
