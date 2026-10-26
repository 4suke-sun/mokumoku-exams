import { describe, expect, it } from "vitest";
import { buildSnapshot, checkRemovedIds } from "./retired-ids-check.ts";

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

describe("非公開の問題を含む一覧", () => {
  const code = (...files: { name: string; ids: string[] }[]) => buildSnapshot(files);

  it("公開から非公開へ移した_削除とみなさず通す", () => {
    const base = code({ name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001", "SAMPLE-0002"] });
    const current = code(
      { name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001"] },
      { name: "unpublished.ex-smp-xx.json", ids: ["SAMPLE-0002"] },
    );
    expect(checkRemovedIds(base, current, {}, fileOf)).toEqual([]);
  });

  it("非公開から公開へ戻した_削除とみなさず通す", () => {
    const base = code(
      { name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001"] },
      { name: "unpublished.ex-smp-xx.json", ids: ["SAMPLE-0002"] },
    );
    const current = code({ name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001", "SAMPLE-0002"] });
    expect(checkRemovedIds(base, current, {}, fileOf)).toEqual([]);
  });

  it("非公開のファイルから消した_削除として、退役した ID に求める", () => {
    const base = code(
      { name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001"] },
      { name: "unpublished.ex-smp-xx.json", ids: ["SAMPLE-0002"] },
    );
    const current = code({ name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001"] });
    expect(checkRemovedIds(base, current, {}, fileOf)).toEqual([
      "questions.ex-smp-xx.json: 削除した問題 ID SAMPLE-0002 が、資格マスタの retiredQuestionIds にありません",
    ]);
    expect(checkRemovedIds(base, current, { "EX-SMP-XX": ["SAMPLE-0002"] }, fileOf)).toEqual([]);
  });

  it("公開のファイルから消し、非公開にも入れていない_削除として止める(従来どおり)", () => {
    const base = code({ name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001", "SAMPLE-0002"] });
    const current = code(
      { name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001"] },
      { name: "unpublished.ex-smp-xx.json", ids: ["SAMPLE-0009"] },
    );
    expect(checkRemovedIds(base, current, {}, fileOf)).toHaveLength(1);
  });

  it("資格ごとに数える_別の資格の非公開のファイルは、混ざらない", () => {
    const snap = code(
      { name: "questions.ex-smp-xx.json", ids: ["SAMPLE-0001"] },
      { name: "unpublished.ex-oth-xx.json", ids: ["OTHER-0001"] },
    );
    expect(snap["questions.ex-smp-xx.json"]).toEqual(["SAMPLE-0001"]);
    expect(snap["questions.ex-oth-xx.json"]).toEqual(["OTHER-0001"]);
  });

  it("関係のないファイル名_数えない", () => {
    expect(code({ name: "exams.json", ids: ["X-0001"] })).toEqual({});
  });
});
