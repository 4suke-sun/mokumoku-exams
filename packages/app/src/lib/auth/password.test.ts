import { describe, expect, it } from "vitest";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "./password.ts";

describe("passwordProblem", () => {
  it("規則を満たすとき_null", () => {
    expect(passwordProblem("Abcdefghij12")).toBeNull();
  });

  it.each([
    ["Abcdefgh12", "短い"],
    ["abcdefghijk12", "大文字がない"],
    ["ABCDEFGHIJK12", "小文字がない"],
    ["Abcdefghijkl", "数字がない"],
  ])("%sは_%sので問題を返す", (password) => {
    expect(passwordProblem(password)).not.toBeNull();
  });

  it("最小の長さは_インフラの設定と同じ", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });
});
