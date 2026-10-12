import { describe, expect, it } from "vitest";
import { stepIndex, summaryKeyAction } from "./summary-keys.ts";

const press = (key: string, over: Partial<Parameters<typeof summaryKeyAction>[0]> = {}) =>
  summaryKeyAction({ key, ctrlKey: false, metaKey: false, altKey: false, targetTag: "BODY", ...over });

describe("summaryKeyAction", () => {
  it("N と → は次へ_P と ← は前へ", () => {
    for (const key of ["n", "N", "ArrowRight"]) expect(press(key)).toBe("next");
    for (const key of ["p", "P", "ArrowLeft"]) expect(press(key)).toBe("previous");
  });

  it("A と Enter は答えの開閉", () => {
    expect(press("a")).toBe("toggle");
    expect(press("A")).toBe("toggle");
    expect(press("Enter")).toBe("toggle");
  });

  it("ボタン・リンクにフォーカスがある_Enter はその操作にまかせる", () => {
    expect(press("Enter", { targetTag: "BUTTON" })).toBeNull();
    expect(press("Enter", { targetTag: "A" })).toBeNull();
    // 前後のキーは、ボタンにフォーカスがあっても使える
    expect(press("n", { targetTag: "BUTTON" })).toBe("next");
  });

  it("入力欄にフォーカスがある_入力にまかせる", () => {
    expect(press("n", { targetTag: "INPUT" })).toBeNull();
    expect(press("a", { targetTag: "textarea" })).toBeNull();
  });

  it("修飾キーつき・対応しないキー_何もしない", () => {
    expect(press("n", { ctrlKey: true })).toBeNull();
    expect(press("ArrowRight", { altKey: true })).toBeNull();
    expect(press("a", { metaKey: true })).toBeNull();
    expect(press("x")).toBeNull();
  });
});

describe("stepIndex", () => {
  it("最後の次は最初_最初の前は最後(巡回する)", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(1, 3, 1)).toBe(2);
  });

  it("カードが 1 枚_同じカードのまま", () => {
    expect(stepIndex(0, 1, 1)).toBe(0);
    expect(stepIndex(0, 1, -1)).toBe(0);
  });

  it("カードがない_0", () => {
    expect(stepIndex(0, 0, 1)).toBe(0);
  });
});
