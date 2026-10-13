import { normalizeKeyword } from "@mokumoku-exams/data-schema/exam-data/schema";
import { describe, expect, it } from "vitest";
import { judgeFreeText, normalizeForMatch } from "./free-text.ts";
import type { Rubric } from "./types.ts";

const rubric: Rubric = {
  criteria: [
    { name: "観点 1", keywords: ["保存", "格納"], points: 60 },
    { name: "観点 2", keywords: ["S3"], points: 40 },
  ],
  passingPoints: 60,
};

describe("judgeFreeText", () => {
  it("すべての観点のキーワードを含む_満点で正解", () => {
    const judgement = judgeFreeText(rubric, "S3 にファイルを保存する");
    expect(judgement).toEqual({
      criteria: [
        { name: "観点 1", points: 60, met: true },
        { name: "観点 2", points: 40, met: true },
      ],
      earned: 100,
      total: 100,
      passingPoints: 60,
      passed: true,
    });
  });

  it("観点のキーワードのどれか 1 つで_その観点を満たす", () => {
    expect(judgeFreeText(rubric, "ファイルを格納する").criteria[0]?.met).toBe(true);
  });

  it("合格点ちょうど_正解。合格点に届かない_不正解(部分点は残る)", () => {
    expect(judgeFreeText(rubric, "保存する")).toMatchObject({ earned: 60, passed: true });
    expect(judgeFreeText(rubric, "S3 を使う")).toMatchObject({ earned: 40, passed: false });
  });

  it("キーワードを含まない・空の回答_0 点で不正解", () => {
    expect(judgeFreeText(rubric, "わかりません")).toMatchObject({ earned: 0, passed: false });
    expect(judgeFreeText(rubric, "")).toMatchObject({ earned: 0, passed: false });
  });

  it("全角半角・大文字小文字・空白の違い_同じキーワードとして照合する", () => {
    expect(judgeFreeText(rubric, "ｓ３ に 保 存")).toMatchObject({ earned: 100, passed: true });
    expect(normalizeForMatch(" Ａ b\nC ")).toBe("abc");
  });

  it("ならすと空になるキーワード_どの回答にも含まれないものとして扱う", () => {
    const blank: Rubric = { criteria: [{ name: "観点", keywords: [" "], points: 10 }], passingPoints: 10 };
    expect(judgeFreeText(blank, "なんでも").passed).toBe(false);
  });
});

describe("judgeFreeText(観点が 3 つの採点基準)", () => {
  // 動作確認用の架空の採点基準。配点の合計は 100、合格点は 70
  const three: Rubric = {
    criteria: [
      { name: "置き場所", keywords: ["Object Storage", "オブジェクトストレージ"], points: 40 },
      { name: "耐久性", keywords: ["冗長化", "複製"], points: 30 },
      { name: "料金", keywords: ["従量課金", "使った分"], points: 30 },
    ],
    passingPoints: 70,
  };
  const met = (answer: string) => judgeFreeText(three, answer).criteria.map((c) => c.met);

  it("想定解答_すべての観点を満たし、満点で正解", () => {
    const answer = "オブジェクトストレージに置き、データは複製して冗長化される。料金は使った分だけの従量課金。";
    expect(judgeFreeText(three, answer)).toEqual({
      criteria: [
        { name: "置き場所", points: 40, met: true },
        { name: "耐久性", points: 30, met: true },
        { name: "料金", points: 30, met: true },
      ],
      earned: 100,
      total: 100,
      passingPoints: 70,
      passed: true,
    });
  });

  it("部分点_満たした観点の配点だけを足す", () => {
    expect(judgeFreeText(three, "オブジェクトストレージに置く")).toMatchObject({ earned: 40, passed: false });
    expect(met("オブジェクトストレージに置く")).toEqual([true, false, false]);
    expect(judgeFreeText(three, "複製して、使った分だけ払う")).toMatchObject({ earned: 60, passed: false });
    expect(met("複製して、使った分だけ払う")).toEqual([false, true, true]);
  });

  it("同じ観点のキーワードを複数含んでも_配点は 1 回だけ", () => {
    expect(judgeFreeText(three, "複製で冗長化し、さらに複製する")).toMatchObject({ earned: 30, total: 100 });
  });

  it("誤答_キーワードを含まない回答は 0 点で不正解", () => {
    expect(judgeFreeText(three, "ブロックストレージに置き、定額で払う")).toMatchObject({
      earned: 0,
      total: 100,
      passed: false,
    });
    expect(met("ブロックストレージに置き、定額で払う")).toEqual([false, false, false]);
  });

  it("キーワードの一部だけを含む回答_観点を満たさない", () => {
    expect(met("オブジェクトに置く。冗長な説明。使う分")).toEqual([false, false, false]);
  });

  it("合格点ちょうど_正解。1 つ下_不正解", () => {
    expect(judgeFreeText(three, "オブジェクトストレージに置き、複製する")).toMatchObject({ earned: 70, passed: true });
    const below: Rubric = { ...three, passingPoints: 71 };
    expect(judgeFreeText(below, "オブジェクトストレージに置き、複製する")).toMatchObject({
      earned: 70,
      passed: false,
    });
  });

  it("表記のゆれ: 全角半角_同じキーワードとして照合する", () => {
    expect(met("ｵﾌﾞｼﾞｪｸﾄｽﾄﾚｰｼﾞ")).toEqual([true, false, false]);
    expect(met("Ｏｂｊｅｃｔ　Ｓｔｏｒａｇｅ")).toEqual([true, false, false]);
  });

  it("表記のゆれ: 大文字小文字_同じキーワードとして照合する", () => {
    expect(met("object storage")).toEqual([true, false, false]);
    expect(met("OBJECT STORAGE")).toEqual([true, false, false]);
  });

  it("表記のゆれ: 空白(半角・全角・改行・タブ、有無の違い)_同じキーワードとして照合する", () => {
    expect(met("ObjectStorage")).toEqual([true, false, false]);
    expect(met("Object 　 Storage")).toEqual([true, false, false]);
    expect(met("従量\n課金")).toEqual([false, false, true]);
    expect(met("冗\t長\t化")).toEqual([false, true, false]);
  });
});

describe("normalizeForMatch と、データの検査のならし方", () => {
  it("同じ結果になる(ならすと空になるキーワードを、検査で止めるため)", () => {
    for (const value of [" Ａ b\nC ", "ｵﾌﾞｼﾞｪｸﾄ", "　\t", "Object Storage", "従量 課金"]) {
      expect(normalizeForMatch(value)).toBe(normalizeKeyword(value));
    }
  });
});
