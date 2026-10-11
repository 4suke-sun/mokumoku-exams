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
