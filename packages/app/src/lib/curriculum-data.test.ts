import { describe, expect, it } from "vitest";
import { type CurriculumUnit, loadCurriculum, sortUnits } from "./curriculum-data.ts";
import { findPublishedExam } from "./exam-data.ts";
import type { PublishedExam } from "./types.ts";

const unit = (id: string, order: number): CurriculumUnit => ({
  id,
  title: id,
  order,
  sections: [{ id: "s", title: "節", body: "本文" }],
  questionIds: ["SAMPLE-0001"],
});

describe("カリキュラムの読み込み", () => {
  it("単元_順番の小さい順に並べる(ファイルの並びによらない)", () => {
    expect(sortUnits([unit("c", 3), unit("a", 1), unit("b", 2)]).map((u) => u.id)).toEqual(["a", "b", "c"]);
  });

  it("サンプル資格_カリキュラムの単元を返す", async () => {
    const exam = findPublishedExam("SAMPLE");
    if (!exam) throw new Error("サンプル資格がありません");
    const units = await loadCurriculum(exam);
    expect(units?.length).toBeGreaterThan(0);
    expect(units?.map((u) => u.order)).toEqual([...(units ?? [])].map((u) => u.order).sort((a, b) => a - b));
  });

  it("カリキュラムのファイルがない資格_null(学習モードを使えない)", async () => {
    expect(await loadCurriculum({ examCode: "NOFILE" } as PublishedExam)).toBeNull();
  });
});
