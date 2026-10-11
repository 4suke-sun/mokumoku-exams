import { describe, expect, it } from "vitest";
import { quizKeyAction } from "./keyboard.ts";

const keys = ["A", "B", "C", "D"];
const press = (
  key: string,
  extra: Partial<Parameters<typeof quizKeyAction>[0]> = {},
  phase?: Parameters<typeof quizKeyAction>[2],
) => quizKeyAction({ key, ctrlKey: false, metaKey: false, altKey: false, targetTag: "body", ...extra }, keys, phase);

describe("quizKeyAction", () => {
  it("選択肢のキー_大文字でも小文字でも選ぶ", () => {
    expect(press("a")).toEqual({ type: "choose", key: "A" });
    expect(press("C")).toEqual({ type: "choose", key: "C" });
  });

  it("数字のキー_その番目の選択肢を選ぶ", () => {
    expect(press("1")).toEqual({ type: "choose", key: "A" });
    expect(press("4")).toEqual({ type: "choose", key: "D" });
  });

  it("選択肢にないキー_何もしない", () => {
    expect(press("E")).toBeNull();
    expect(press("5")).toBeNull();
    expect(press("0")).toBeNull();
    expect(press("ArrowRight")).toBeNull();
  });

  it("Enter と N_次へ進む", () => {
    expect(press("Enter")).toEqual({ type: "next" });
    expect(press("n")).toEqual({ type: "next" });
    expect(press("N")).toEqual({ type: "next" });
  });

  it("P_前へ戻る", () => {
    expect(press("p")).toEqual({ type: "previous" });
  });

  it("文章の入力欄の中_どのキーも入力にまかせる(自由記述)", () => {
    for (const key of ["a", "N", "p", "Enter"]) expect(press(key, { targetTag: "TEXTAREA" }), key).toBeNull();
  });

  it("ボタンやリンクの上の Enter_その要素の操作にまかせる", () => {
    expect(press("Enter", { targetTag: "BUTTON" })).toBeNull();
    expect(press("Enter", { targetTag: "a" })).toBeNull();
    expect(press("Enter", { targetTag: "input" })).toEqual({ type: "next" });
  });

  it("修飾キーつき_ブラウザの操作なので扱わない", () => {
    expect(press("a", { metaKey: true })).toBeNull();
    expect(press("n", { ctrlKey: true })).toBeNull();
    expect(press("p", { altKey: true })).toBeNull();
  });

  it("1 問ごとの出題の回答する前_Enter で回答し_N は回答せずに次へ_選択のキーは使える", () => {
    expect(press("Enter", {}, "checking")).toEqual({ type: "submit" });
    expect(press("n", {}, "checking")).toEqual({ type: "next" });
    expect(press("b", {}, "checking")).toEqual({ type: "choose", key: "B" });
    expect(press("2", {}, "checking")).toEqual({ type: "choose", key: "B" });
  });

  it("1 問ごとの出題の回答したあと_Enter で次へ_選択のキーは使わない", () => {
    expect(press("Enter", {}, "checked")).toEqual({ type: "next" });
    expect(press("p", {}, "checked")).toEqual({ type: "previous" });
    expect(press("a", {}, "checked")).toBeNull();
    expect(press("1", {}, "checked")).toBeNull();
  });
});
