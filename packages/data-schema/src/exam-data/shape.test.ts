import { describe, expect, it } from "vitest";
import { EXAM_CODE, EXAM_CODE_MAX_LENGTH, normalizeKeyword, QUESTION_ID, QUESTION_ID_MAX_LENGTH } from "./shape.ts";

describe("試験コードの形", () => {
  it("契約が許す最大の長さのコード_通し、最大の長さと一致する", () => {
    const longest = `${"A".repeat(6)}-${"B".repeat(10)}-${"C".repeat(4)}`;
    expect(EXAM_CODE.test(longest)).toBe(true);
    expect(longest).toHaveLength(EXAM_CODE_MAX_LENGTH);
  });

  it("最大を 1 文字超えるコードや小文字_通さない", () => {
    expect(EXAM_CODE.test(`${"A".repeat(7)}-BB-CC`)).toBe(false);
    expect(EXAM_CODE.test("aws-aib-c01")).toBe(false);
  });
});

describe("問題 ID の形", () => {
  it("最大の長さの接頭辞と 4 桁の連番_通し、最大の長さと一致する", () => {
    const longest = `${"A".repeat(16)}-0001`;
    expect(QUESTION_ID.test(longest)).toBe(true);
    expect(longest).toHaveLength(QUESTION_ID_MAX_LENGTH);
  });

  it("連番が 4 桁でない ID_通さない", () => {
    expect(QUESTION_ID.test("AIB-001")).toBe(false);
    expect(QUESTION_ID.test("AIB-00001")).toBe(false);
  });
});

describe("キーワードのならし方", () => {
  it("全角・半角、大文字・小文字、空白の違い_同じ値にならす", () => {
    expect(normalizeKeyword(" Ａ b\nC ")).toBe("abc");
    expect(normalizeKeyword("　\t")).toBe("");
  });
});
