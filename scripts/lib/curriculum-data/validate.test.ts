import { describe, expect, it } from "vitest";
import { validateCurriculumData } from "./validate.ts";

const context = { questionIds: new Map([["SAMPLE", new Set(["SAMPLE-0001", "SAMPLE-0002", "SAMPLE-0003"])]]) };

const section = (over: Record<string, unknown> = {}) => ({
  id: "intro",
  title: "はじめに",
  body: "本文です。",
  ...over,
});
const unit = (over: Record<string, unknown> = {}) => ({
  id: "unit-one",
  title: "単元 1",
  order: 1,
  sections: [section()],
  questionIds: ["SAMPLE-0001"],
  ...over,
});
const curriculum = (units: unknown[] = [unit()], examCode = "SAMPLE") => ({ examCode, units });
const files = (data: unknown = curriculum(), name = "curriculum.sample.json") => [{ name, data }];

describe("validateCurriculumData", () => {
  it("正しいデータ_指摘なし", () => {
    const data = curriculum([unit(), unit({ id: "unit-two", order: 2, questionIds: ["SAMPLE-0002", "SAMPLE-0001"] })]);
    expect(validateCurriculumData(files(data), context)).toEqual([]);
  });

  it("カリキュラムのファイルがない_指摘なし(カリキュラムは任意)", () => {
    expect(validateCurriculumData([], context)).toEqual([]);
  });

  it("問題データにない問題 ID_場所と種類だけを報告する", () => {
    const errors = validateCurriculumData(files(curriculum([unit({ questionIds: ["SAMPLE-0099"] })])), context);
    expect(errors).toEqual(["curriculum.sample.json: units[0].questionIds[0]: 問題データにない問題です"]);
  });

  it("別の資格の問題 ID_接頭辞の食い違いとして報告する", () => {
    const errors = validateCurriculumData(files(curriculum([unit({ questionIds: ["OTHER-0001"] })])), context);
    expect(errors).toEqual([
      "curriculum.sample.json: units[0].questionIds[0]: 問題の ID の接頭辞が資格コードと一致しません",
    ]);
  });

  it("単元の ID・単元の順番・節の ID・単元の中の問題 ID の重複_それぞれ報告する", () => {
    const dupUnit = validateCurriculumData(files(curriculum([unit(), unit({ order: 2 })])), context);
    expect(dupUnit).toEqual(["curriculum.sample.json: units[1].id: 単元の ID が重複しています"]);

    const dupOrder = validateCurriculumData(files(curriculum([unit(), unit({ id: "unit-two" })])), context);
    expect(dupOrder).toEqual(["curriculum.sample.json: units[1].order: 単元の順番が重複しています"]);

    const dupSection = validateCurriculumData(files(curriculum([unit({ sections: [section(), section()] })])), context);
    expect(dupSection).toEqual(["curriculum.sample.json: units[0].sections[1].id: 節の ID が重複しています"]);

    const dupQuestion = validateCurriculumData(
      files(curriculum([unit({ questionIds: ["SAMPLE-0001", "SAMPLE-0001"] })])),
      context,
    );
    expect(dupQuestion).toEqual(["curriculum.sample.json: units[0].questionIds[1]: 問題の ID が重複しています"]);
  });

  it("必須の項目がない・空・未知の項目_指摘する", () => {
    const { sections: _omit, ...noSections } = unit();
    expect(validateCurriculumData(files(curriculum([noSections])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([unit({ questionIds: [] })])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([unit({ extra: 1 })])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([unit({ sections: [section({ body: "  " })] })])), context)).toEqual(
      ["curriculum.sample.json: units[0].sections[0].body: 形式が違います"],
    );
  });

  it("ID の形・順番の値が正しくない_指摘する", () => {
    for (const id of ["Unit", "1unit", "unit_one", "a".repeat(33)]) {
      expect(validateCurriculumData(files(curriculum([unit({ id })])), context), id).toHaveLength(1);
    }
    for (const order of [0, -1, 1.5, "1"]) {
      expect(validateCurriculumData(files(curriculum([unit({ order })])), context), String(order)).toHaveLength(1);
    }
  });

  it("ファイル名の形が違う・ファイル名とコードが違う_指摘する", () => {
    expect(validateCurriculumData(files(curriculum(), "curriculum.SAMPLE.json"), context)).toEqual([
      "curriculum.SAMPLE.json: ファイル名が curriculum.<コード(英小文字と数字)>.json の形ではありません",
    ]);
    expect(validateCurriculumData(files(curriculum(), "curriculum.other.json"), context)).toEqual([
      "curriculum.other.json: examCode がファイル名のコードと一致しません",
    ]);
  });

  it("公開中ではない資格・問題データのない資格のカリキュラム_指摘する", () => {
    const data = curriculum([unit({ questionIds: ["LATER-0001"] })], "LATER");
    expect(validateCurriculumData(files(data, "curriculum.later.json"), context)).toEqual([
      "curriculum.later.json: 公開中の資格(問題データのある資格)のカリキュラムではありません",
    ]);
  });

  it("報告に入力の値を含めない", () => {
    const marker = "目印XYZ";
    const data = curriculum([unit({ title: 1, sections: [section({ id: marker })], questionIds: [marker] })]);
    const errors = validateCurriculumData(files(data), context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).not.toContain(marker);
  });
});
