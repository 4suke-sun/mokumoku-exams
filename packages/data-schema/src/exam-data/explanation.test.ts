import { describe, expect, it } from "vitest";
import { explanationGroups, INTRO_TITLE, pairChoices, unpairedWrongParagraphs } from "./explanation.ts";

const choices = [
  { key: "A", text: "10 個" },
  { key: "B", text: "100 個" },
  { key: "C", text: "上限はない" },
];

describe("explanationGroups", () => {
  it("見出しの前の段落と、名前だけの段落の見出し_要件のまとまりと、種類ごとのまとまりに分ける", () => {
    const groups = explanationGroups("前置きです。\n\n他の選択肢が誤りである理由：\n\n10 個\n\n小さすぎます。");
    expect(groups.map((g) => [g.kind, g.title, g.paragraphs.length])).toEqual([
      ["requirement", INTRO_TITLE, 1],
      ["wrong", "他の選択肢が誤りである理由", 2],
    ]);
  });
});

describe("pairChoices", () => {
  it("選択肢の本文の段落の次に理由の段落_空白と読点・句点の違いを問わず組にする", () => {
    expect(pairChoices(["10個。", "小さすぎます。"], choices)).toEqual([
      { type: "choice", choiceKey: "A", choiceText: "10個。", reason: "小さすぎます。" },
    ]);
  });

  it("理由の段落がない、次も選択肢の本文_組にせず普通の段落のまま", () => {
    expect(pairChoices(["10 個", "上限はない", "誤りです。"], choices).map((b) => b.type)).toEqual(["text", "choice"]);
    expect(pairChoices(["10 個"], choices).map((b) => b.type)).toEqual(["text"]);
  });
});

describe("unpairedWrongParagraphs", () => {
  it("誤りの理由の節が組だけ、または節がない_0", () => {
    expect(unpairedWrongParagraphs("## 他の選択肢が誤りである理由\n\n10 個\n\n小さすぎます。", choices)).toBe(0);
    expect(unpairedWrongParagraphs("正解は 100 個です。", choices)).toBe(0);
  });

  it("誤りの理由の節に前置きや補足がある_組にできない段落の数", () => {
    const source = "## 他の選択肢が誤りである理由\n\n次のとおりです。\n\n10 個\n\n小さすぎます。\n\n以上です。";
    expect(unpairedWrongParagraphs(source, choices)).toBe(2);
  });
});
