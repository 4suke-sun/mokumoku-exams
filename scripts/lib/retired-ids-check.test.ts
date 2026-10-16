import { describe, expect, it } from "vitest";
import { checkRemovedIds } from "./retired-ids-check.ts";

const fileOf = (file: string) => (file === "questions.ex-smp-xx.json" ? "EX-SMP-XX" : null);

describe("削除した問題 ID の検査", () => {
  it("問題を足しただけ_通す", () => {
    const base = { "questions.ex-smp-xx.json": ["SAMPLE-0001"] };
    const current = { "questions.ex-smp-xx.json": ["SAMPLE-0001", "SAMPLE-0002"] };
    expect(checkRemovedIds(base, current, {}, fileOf)).toEqual([]);
  });

  it("問題を削除し、退役した ID に足した_通す", () => {
    const base = { "questions.ex-smp-xx.json": ["SAMPLE-0001", "SAMPLE-0002"] };
    const current = { "questions.ex-smp-xx.json": ["SAMPLE-0001"] };
    expect(checkRemovedIds(base, current, { "EX-SMP-XX": ["SAMPLE-0002"] }, fileOf)).toEqual([]);
  });

  it("問題を削除し、退役した ID に足していない_ファイル名と ID だけで止める", () => {
    const base = { "questions.ex-smp-xx.json": ["SAMPLE-0001", "SAMPLE-0002"] };
    const current = { "questions.ex-smp-xx.json": ["SAMPLE-0001"] };
    expect(checkRemovedIds(base, current, {}, fileOf)).toEqual([
      "questions.ex-smp-xx.json: 削除した問題 ID SAMPLE-0002 が、資格マスタの retiredQuestionIds にありません",
    ]);
  });

  it("ファイルごと削除した_すべての ID を退役した ID に求める", () => {
    const base = { "questions.ex-smp-xx.json": ["SAMPLE-0001"] };
    expect(checkRemovedIds(base, {}, {}, fileOf)).toHaveLength(1);
  });
});
