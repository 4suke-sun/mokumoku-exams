import { describe, expect, it } from "vitest";
import { bigrams, dice, jaccard } from "./similarity.ts";

describe("文字の 2 つ組の類似度", () => {
  it("2 文字以上の文_隣り合う 2 文字の集合になる", () => {
    expect([...bigrams("abc")].sort()).toEqual(["ab", "bc"]);
  });

  it("1 文字の文_その 1 文字だけの集合になり、空の文は空", () => {
    expect([...bigrams("a")]).toEqual(["a"]);
    expect(bigrams("").size).toBe(0);
  });

  it("サロゲートペアの文字_1 文字として数える", () => {
    expect(bigrams("𠮷a").size).toBe(1);
  });

  it("空白と全角半角・大文字小文字の違い_そろえてから比べる", () => {
    expect(dice("ＡＢＣ d", "abcd")).toBe(1);
  });

  it("同じ文と共通のない文_Dice 係数は 1 と 0", () => {
    expect(dice("バケット", "バケット")).toBe(1);
    expect(dice("abcd", "wxyz")).toBe(0);
  });

  it("共通する組がある文_Dice は 2×共通÷(合計)、Jaccard は共通÷和集合", () => {
    // abc: ab,bc / abd: ab,bd → 共通 1
    expect(dice("abc", "abd")).toBeCloseTo(0.5);
    expect(jaccard("abc", "abd")).toBeCloseTo(1 / 3);
  });

  it("空の文_どちらの係数も 0", () => {
    expect(dice("", "abc")).toBe(0);
    expect(jaccard("abc", "")).toBe(0);
  });
});
