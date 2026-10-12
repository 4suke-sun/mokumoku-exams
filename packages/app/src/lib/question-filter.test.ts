import { describe, expect, it } from "vitest";
import { clampPage, EMPTY_FILTER, filterQuestions, PREVIEW_PAGE_SIZE, pageCount } from "./question-filter.ts";
import type { Question } from "./types.ts";

const q = (id: string, over: Record<string, unknown> = {}): Question =>
  ({
    questionId: id,
    examCode: "T",
    domain: "domain1",
    questionType: "single",
    difficulty: "easy",
    questionText: "問題文",
    explanation: "解説",
    choices: [],
    correctAnswers: [],
    ...over,
  }) as unknown as Question;

const all = [
  q("T-0001"),
  q("T-0002", { domain: "domain2", difficulty: "hard" }),
  q("T-0003", { domain: "domain2", difficulty: undefined, questionType: "multiple", questionText: "ＡＷＳ の問題" }),
  q("T-0004", { questionType: "free-text", explanation: "ルールベースの説明" }),
];
const ids = (list: Question[]) => list.map((x) => x.questionId);

describe("filterQuestions", () => {
  it("絞らない_すべてを元の並びで返す", () => {
    expect(ids(filterQuestions(all, EMPTY_FILTER))).toEqual(["T-0001", "T-0002", "T-0003", "T-0004"]);
  });

  it("分野_選んだ分野だけ(複数を選ぶと、どれかに合うもの)", () => {
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, domains: ["domain2"] }))).toEqual(["T-0002", "T-0003"]);
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, domains: ["domain1", "domain2"] }))).toHaveLength(4);
  });

  it("難易度_難易度のない問題は none で選べる", () => {
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, difficulties: ["hard"] }))).toEqual(["T-0002"]);
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, difficulties: ["none"] }))).toEqual(["T-0003"]);
  });

  it("問題の種類", () => {
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, types: ["free-text", "multiple"] }))).toEqual([
      "T-0003",
      "T-0004",
    ]);
  });

  it("語_問題 ID・問題文・解説に含むもの(全角・半角と大文字・小文字は区別しない)", () => {
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, keyword: "aws" }))).toEqual(["T-0003"]);
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, keyword: "ルールベース" }))).toEqual(["T-0004"]);
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, keyword: "t-0002" }))).toEqual(["T-0002"]);
    expect(ids(filterQuestions(all, { ...EMPTY_FILTER, keyword: "  " }))).toHaveLength(4);
  });

  it("条件を組み合わせる_すべてに合うものだけ", () => {
    const filter = { ...EMPTY_FILTER, domains: ["domain2"], difficulties: ["hard"] as const };
    expect(ids(filterQuestions(all, { ...filter, difficulties: [...filter.difficulties] }))).toEqual(["T-0002"]);
  });

  it("合うものがない_空", () => {
    expect(filterQuestions(all, { ...EMPTY_FILTER, keyword: "存在しない語" })).toEqual([]);
  });
});

describe("ページ", () => {
  it("ページの数_0 件でも 1 ページ", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(PREVIEW_PAGE_SIZE)).toBe(1);
    expect(pageCount(PREVIEW_PAGE_SIZE + 1)).toBe(2);
  });

  it("ページの番号_範囲に収める", () => {
    expect(clampPage(-3, 45)).toBe(0);
    expect(clampPage(9, 45)).toBe(2);
    expect(clampPage(1, 45)).toBe(1);
    expect(clampPage(5, 0)).toBe(0);
  });
});
