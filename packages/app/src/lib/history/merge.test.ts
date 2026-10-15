import { describe, expect, it } from "vitest";
import { MAX_RESULTS, type Result } from "@/lib/storage.ts";
import { appendResults, mergeResults, pendingMigration } from "./merge.ts";

const result = (minute: number, examCode = "EX-SMP-XX"): Result => ({
  examCode,
  questionIds: ["Q-0001"],
  answers: {},
  finishedAt: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
});

describe("pendingMigration", () => {
  it("サーバーにない端末の結果だけ_移行の対象にする", () => {
    expect(pendingMigration([result(1), result(2)], [result(2)])).toEqual([result(1)]);
  });

  it("すべてサーバーにある_対象なし", () => {
    expect(pendingMigration([result(1)], [result(1), result(2)])).toEqual([]);
  });

  it("端末に結果がない_対象なし", () => {
    expect(pendingMigration([], [result(1)])).toEqual([]);
  });
});

describe("mergeResults", () => {
  it("サーバーと移行前の結果_新しい順にまとめる", () => {
    expect(mergeResults([result(1), result(3)], [result(2)]).map((r) => r.finishedAt)).toEqual([
      result(3).finishedAt,
      result(2).finishedAt,
      result(1).finishedAt,
    ]);
  });

  it("上限を超える_新しいものから上限の件数にする", () => {
    const many = Array.from({ length: MAX_RESULTS + 5 }, (_, i) => result(i));
    expect(mergeResults(many, [])).toHaveLength(MAX_RESULTS);
    expect(mergeResults(many, [])[0]?.finishedAt).toBe(result(MAX_RESULTS + 4).finishedAt);
  });
});

describe("一覧の続きを足す", () => {
  it("続きを下に足し_すでにある完了時刻の結果は足さない", () => {
    const at = (day: number) => ({
      examCode: "EX-SMP-XX",
      questionIds: ["SAMPLE-0001"],
      answers: {},
      finishedAt: `2026-10-0${day}T00:00:00.000Z`,
    });
    expect(appendResults([at(3), at(2)], [at(2), at(1)]).map((r) => r.finishedAt)).toEqual([
      at(3).finishedAt,
      at(2).finishedAt,
      at(1).finishedAt,
    ]);
  });
});
