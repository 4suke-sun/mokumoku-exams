import { describe, expect, it } from "vitest";
import { listExams, visibleExams } from "./exam-data.ts";

describe("visibleExams", () => {
  const exams = listExams();

  it("本番のビルド_動作確認用の架空の資格を出さない", () => {
    const visible = visibleExams(exams, false);
    expect(visible.some((exam) => exam.vendor === "Example")).toBe(false);
    expect(visible.map((exam) => exam.examCode)).toEqual(
      exams.filter((exam) => exam.vendor !== "Example").map((exam) => exam.examCode),
    );
  });

  it("開発とテスト_動作確認用の架空の資格も出す", () => {
    expect(visibleExams(exams, true)).toEqual(exams);
    expect(exams.some((exam) => exam.vendor === "Example")).toBe(true);
  });
});
