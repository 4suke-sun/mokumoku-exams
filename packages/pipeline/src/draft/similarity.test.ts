import { describe, expect, it } from "vitest";
import { similarity, stemCore, stemSimilarity } from "./similarity.ts";

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

describe("設問文の類似度", () => {
  it("末尾の決まり文句_外して比べる", () => {
    expect(stemCore("ログの保管期間を延ばす方法として、最も適切なものはどれですか。")).toBe(
      "ログの保管期間を延ばす方法として",
    );
    expect(stemCore("適切なものはどれですか。2 つ選択してください。")).toBe(
      "適切なものはどれですか。2 つ選択してください。",
    );
    expect(stemCore("データを分類する。正しいものを 2 つ選んでください。")).toBe(
      "データを分類する。正しいものを 2 つ選んでください。",
    );
  });

  it("論点が違い末尾の言い回しだけ同じ設問_決まり文句を外すと類似度が下がる", () => {
    const a = "AI エージェントの型として挙げられているものはどれですか。2 つ選択してください。";
    const b = "AI の判断に人による監視を組み込む方法として適切なものはどれですか。2 つ選択してください。";
    expect(stemSimilarity(a, b)).toBeLessThan(similarity(a, b));
    expect(stemSimilarity(a, b)).toBeLessThan(0.3);
  });

  it("言い換えただけの設問_決まり文句を外しても重複の高さに残る", () => {
    const a =
      "生成 AI のトランスフォーメーションへの投資について、経営層に説明することになりました。説明として最も適切なものはどれですか。";
    const b =
      "生成 AI のトランスフォーメーションへの投資について、経営層に説明することになった。最も適切な説明はどれか。";
    expect(stemSimilarity(a, b)).toBeGreaterThanOrEqual(0.85);
  });
});
