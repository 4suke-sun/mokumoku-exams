import { describe, expect, it } from "vitest";
import { similarity } from "./similarity.ts";

describe("similarity", () => {
  it("同じ文_1 になる", () => {
    expect(similarity("バケットの上限はどれですか", "バケットの上限はどれですか")).toBe(1);
  });

  it("空白と全角半角の違い_同じとみなす", () => {
    expect(similarity("Widget Store の上限", "ＷＩＤＧＥＴ　STORE　の上限")).toBe(1);
  });

  it("共通の文字の組がない文_0 になる", () => {
    expect(similarity("あいう", "かきく")).toBe(0);
  });

  it("一部だけ違う文_0 と 1 の間になる", () => {
    const value = similarity("バケットの上限数はどれですか", "バケットの上限数はいくつですか");
    expect(value).toBeGreaterThan(0.5);
    expect(value).toBeLessThan(1);
  });

  it("どちらかが空_0 になる", () => {
    expect(similarity("", "あ")).toBe(0);
  });

  it("順序を入れ替えても_同じ値になる", () => {
    expect(similarity("あいうえお", "いうえおか")).toBe(similarity("いうえおか", "あいうえお"));
  });
});
