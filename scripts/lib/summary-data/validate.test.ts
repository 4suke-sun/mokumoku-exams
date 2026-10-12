import { describe, expect, it } from "vitest";
import { validateSummaryData } from "./validate.ts";

const context = {
  questions: new Map([
    [
      "EX-SMP-XX",
      new Map<string, readonly string[] | null>([
        ["SAMPLE-0001", ["B"]],
        ["SAMPLE-0002", ["A", "C"]],
        ["SAMPLE-0006", null],
      ]),
    ],
  ]),
};

const card = (over: Record<string, unknown> = {}) => ({
  questionId: "SAMPLE-0001",
  question: "信号機の青は何を表すか",
  answers: ["B"],
  point: "青(緑)は進んでよいことを表す",
  ...over,
});
const file = (cards: unknown[] = [card()], examCode = "EX-SMP-XX") => ({ examCode, cards });
const files = (data: unknown = file(), name = "summary.ex-smp-xx.json") => [{ name, data }];

describe("validateSummaryData", () => {
  it("正しいデータ_指摘なし(正解の並びは問わない)", () => {
    const data = file([card(), card({ questionId: "SAMPLE-0002", answers: ["C", "A"] })]);
    expect(validateSummaryData(files(data), context)).toEqual([]);
  });

  it("要約カードのファイルがない_指摘なし(要約カードは任意)", () => {
    expect(validateSummaryData([], context)).toEqual([]);
  });

  it("問題データにない問題 ID_場所と種類だけを報告する", () => {
    expect(validateSummaryData(files(file([card({ questionId: "SAMPLE-0099" })])), context)).toEqual([
      "summary.ex-smp-xx.json: cards[0].questionId: 問題データにない問題です",
    ]);
  });

  it("別の資格の問題 ID_問題データにない問題として報告する", () => {
    const errors = validateSummaryData(files(file([card({ questionId: "OTHER-0001" })])), context);
    expect(errors).toContain("summary.ex-smp-xx.json: cards[0].questionId: 問題データにない問題です");
  });

  it("答えのキーが問題の正解と一致しない_不足・過多・別の選択肢を報告する", () => {
    for (const answers of [["A"], ["B", "C"], ["C"]]) {
      expect(validateSummaryData(files(file([card({ answers })])), context)).toEqual([
        "summary.ex-smp-xx.json: cards[0].answers: 問題の正解と一致しません",
      ]);
    }
  });

  it("自由記述の問題_選択式ではないと報告する", () => {
    expect(validateSummaryData(files(file([card({ questionId: "SAMPLE-0006" })])), context)).toEqual([
      "summary.ex-smp-xx.json: cards[0].questionId: 選択式の問題ではありません",
    ]);
  });

  it("本文に URL がある_問いの要約と決め手の場所と種類だけを報告する", () => {
    expect(
      validateSummaryData(files(file([card({ question: "詳しくは https://example.com/ を見る" })])), context),
    ).toEqual(["summary.ex-smp-xx.json: cards[0].question: 本文に URL が含まれています"]);
    expect(validateSummaryData(files(file([card({ point: "www.example.com" })])), context)).toEqual([
      "summary.ex-smp-xx.json: cards[0].point: 本文に URL が含まれています",
    ]);
  });

  it("同じ問題の要約カードが重複している_報告する", () => {
    expect(validateSummaryData(files(file([card(), card()])), context)).toEqual([
      "summary.ex-smp-xx.json: cards[1].questionId: 同じ問題の要約カードが重複しています",
    ]);
  });

  it("必須の項目がない・空・長すぎる・未知の項目・キーの形の誤り_指摘する", () => {
    const { point: _omit, ...noPoint } = card();
    expect(validateSummaryData(files(file([noPoint])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ question: "  " })])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ question: "あ".repeat(121) })])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ point: "あ".repeat(201) })])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ extra: 1 })])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ answers: [] })])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ answers: ["b"] })])), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ answers: ["B", "B"] })])), context)).toEqual([
      "summary.ex-smp-xx.json: cards[0].answers: 正解のキーが重複しています",
    ]);
    expect(validateSummaryData(files(file([])), context)).toHaveLength(1);
  });

  it("ファイル名の形が違う・ファイル名とコードが違う・公開中でない資格_指摘する", () => {
    expect(validateSummaryData(files(file(), "summary.json"), context)).toHaveLength(1);
    expect(validateSummaryData(files(file([card({ questionId: "OTHER-0001" })], "EX-OTH-XX")), context)).toEqual([
      "summary.ex-smp-xx.json: examCode がファイル名のコードと一致しません",
    ]);
    expect(
      validateSummaryData(
        files(file([card({ questionId: "LATER-0001" })], "EX-LTR-XX"), "summary.ex-ltr-xx.json"),
        context,
      ),
    ).toEqual(["summary.ex-ltr-xx.json: 公開中の資格(問題データのある資格)の要約カードではありません"]);
  });

  it("報告に入力の値を含めない", () => {
    const marker = "目印XYZ";
    const data = file([card({ questionId: marker, question: 1, answers: [marker], point: marker.repeat(100) })]);
    const errors = validateSummaryData(files(data), context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).not.toContain(marker);
  });
});
