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
const diagram = (over: Record<string, unknown> = {}) => ({
  title: "流れ",
  nodes: [
    { id: "a", label: "始め" },
    { id: "b", label: "途中" },
    { id: "c", label: "終わり" },
  ],
  edges: [
    { from: "a", to: "b", label: "次に" },
    { from: "b", to: "c" },
    { from: "a", to: "c" },
  ],
  ...over,
});
const withDiagram = (over: Record<string, unknown> = {}) =>
  files(curriculum([unit({ sections: [section({ diagram: diagram(over) })] })]));
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

  it("題・本文・要約・図の文字の URL_場所と種類だけを報告する", () => {
    const url = "https://example.com/";
    const cases: [unknown, string][] = [
      [curriculum([unit({ title: `単元 ${url}` })]), "units[0].title"],
      [curriculum([unit({ summary: [`要点 ${url}`] })]), "units[0].summary[0]"],
      [curriculum([unit({ sections: [section({ title: "www.example.com" })] })]), "units[0].sections[0].title"],
      [curriculum([unit({ sections: [section({ body: "本文 http://example.com" })] })]), "units[0].sections[0].body"],
    ];
    for (const [data, path] of cases) {
      expect(validateCurriculumData(files(data), context)).toEqual([
        `curriculum.sample.json: ${path}: 本文に URL が含まれています`,
      ]);
    }
    expect(validateCurriculumData(withDiagram({ title: `図 ${url}` }), context)).toHaveLength(1);
  });

  it("節の出典_許したドメインは通し、一覧にないドメイン・http は場所と種類だけを報告する", () => {
    const ok = [{ title: "出典", url: "https://docs.aws.amazon.com/" }, { url: "https://www.nist.gov/" }];
    expect(
      validateCurriculumData(files(curriculum([unit({ sections: [section({ references: ok })] })])), context),
    ).toEqual([]);
    const bad = [{ url: "https://learning.example.com/" }, { url: "http://aws.amazon.com/" }];
    expect(
      validateCurriculumData(files(curriculum([unit({ sections: [section({ references: bad })] })])), context),
    ).toEqual([
      "curriculum.sample.json: units[0].sections[0].references[0].url: 出典に許していないドメインの URL です",
      "curriculum.sample.json: units[0].sections[0].references[1].url: https で始まる URL ではありません",
    ]);
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

  it("節の図解_正しい図は指摘なし(図は任意)", () => {
    expect(validateCurriculumData(withDiagram(), context)).toEqual([]);
  });

  it("図解の箱の ID の重複・図にない箱への矢印_場所と種類だけを報告する", () => {
    const nodes = [
      { id: "a", label: "始め" },
      { id: "a", label: "重複" },
    ];
    expect(validateCurriculumData(withDiagram({ nodes, edges: [{ from: "a", to: "a" }] }), context)).toEqual([
      "curriculum.sample.json: units[0].sections[0].diagram.nodes[1].id: 図の箱の ID が重複しています",
      "curriculum.sample.json: units[0].sections[0].diagram.edges[0]: 自分自身への矢印は置けません",
    ]);
    expect(validateCurriculumData(withDiagram({ edges: [{ from: "a", to: "x" }] }), context)).toEqual([
      "curriculum.sample.json: units[0].sections[0].diagram.edges[0].to: 図にない箱を指しています",
    ]);
  });

  it("図解の同じ向きの矢印の重複・閉路_指摘する", () => {
    const dup = [
      { from: "a", to: "b" },
      { from: "a", to: "b", label: "重複" },
    ];
    expect(validateCurriculumData(withDiagram({ edges: dup }), context)).toEqual([
      "curriculum.sample.json: units[0].sections[0].diagram.edges[1]: 同じ向きの矢印が重複しています",
    ]);
    const cycle = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    expect(validateCurriculumData(withDiagram({ edges: cycle }), context)).toEqual([
      "curriculum.sample.json: units[0].sections[0].diagram.edges: 矢印が一周して戻る形(閉路)になっています",
    ]);
    // 逆向きの 2 本も閉路
    const back = [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
    ];
    expect(validateCurriculumData(withDiagram({ edges: back }), context)).toHaveLength(1);
  });

  it("図解の必須の項目がない・空・長すぎる・未知の項目_指摘する", () => {
    expect(validateCurriculumData(withDiagram({ title: " " }), context)).toHaveLength(1);
    expect(validateCurriculumData(withDiagram({ nodes: [{ id: "a", label: "始め" }] }), context)).not.toEqual([]);
    expect(validateCurriculumData(withDiagram({ edges: [] }), context)).toHaveLength(1);
    expect(validateCurriculumData(withDiagram({ extra: 1 }), context)).toHaveLength(1);
    const longLabel = [{ from: "a", to: "b", label: "あ".repeat(13) }];
    expect(validateCurriculumData(withDiagram({ edges: longLabel }), context)).toHaveLength(1);
    const nodes = (first: Record<string, unknown>) => [
      { id: "a", label: "始め", ...first },
      { id: "b", label: "途中" },
    ];
    expect(
      validateCurriculumData(withDiagram({ nodes: nodes({ id: "A" }), edges: [{ from: "b", to: "a" }] }), context),
    ).toEqual([
      "curriculum.sample.json: units[0].sections[0].diagram.nodes[0].id: 形式が違います",
      "curriculum.sample.json: units[0].sections[0].diagram.edges[0].to: 図にない箱を指しています",
    ]);
    expect(
      validateCurriculumData(
        withDiagram({ nodes: nodes({ label: "あ".repeat(21) }), edges: [{ from: "a", to: "b" }] }),
        context,
      ),
    ).toHaveLength(1);
  });

  it("要約と段階のある単元_指摘なし", () => {
    const data = curriculum([
      unit({
        summary: ["要点の 1 つ目", "**要点**の 2 つ目"],
        stages: [
          { order: 2, questionIds: ["SAMPLE-0002", "SAMPLE-0003"] },
          { order: 1, questionIds: ["SAMPLE-0001"] },
        ],
      }),
    ]);
    expect(validateCurriculumData(files(data), context)).toEqual([]);
  });

  it("要約が空・空白だけ・長すぎる・多すぎる_指摘する", () => {
    for (const summary of [[], ["  "], ["あ".repeat(201)], Array.from({ length: 11 }, () => "要点"), "要点"]) {
      expect(validateCurriculumData(files(curriculum([unit({ summary })])), context)).toHaveLength(1);
    }
  });

  it("段階の確認問題が問題データにない・別の資格・重複_場所と種類だけを報告する", () => {
    const missing = validateCurriculumData(
      files(curriculum([unit({ stages: [{ order: 1, questionIds: ["SAMPLE-0099"] }] })])),
      context,
    );
    expect(missing).toEqual(["curriculum.sample.json: units[0].stages[0].questionIds[0]: 問題データにない問題です"]);

    const other = validateCurriculumData(
      files(curriculum([unit({ stages: [{ order: 1, questionIds: ["OTHER-0001"] }] })])),
      context,
    );
    expect(other).toEqual([
      "curriculum.sample.json: units[0].stages[0].questionIds[0]: 問題の ID の接頭辞が資格コードと一致しません",
    ]);

    const dup = validateCurriculumData(
      files(curriculum([unit({ stages: [{ order: 1, questionIds: ["SAMPLE-0001", "SAMPLE-0001"] }] })])),
      context,
    );
    expect(dup).toEqual(["curriculum.sample.json: units[0].stages[0].questionIds[1]: 問題の ID が重複しています"]);
  });

  it("段階の順番の重複・値の誤り・空の段階・未知の項目_指摘する", () => {
    const stage = (over: Record<string, unknown> = {}) => ({ order: 1, questionIds: ["SAMPLE-0001"], ...over });
    expect(validateCurriculumData(files(curriculum([unit({ stages: [stage(), stage()] })])), context)).toEqual([
      "curriculum.sample.json: units[0].stages[1].order: 段階の順番が重複しています",
    ]);
    for (const order of [0, 101, 1.5, "1"]) {
      expect(
        validateCurriculumData(files(curriculum([unit({ stages: [stage({ order })] })])), context),
        String(order),
      ).toHaveLength(1);
    }
    expect(validateCurriculumData(files(curriculum([unit({ stages: [] })])), context)).toHaveLength(1);
    expect(
      validateCurriculumData(files(curriculum([unit({ stages: [stage({ questionIds: [] })] })])), context),
    ).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([unit({ stages: [stage({ extra: 1 })] })])), context)).toHaveLength(
      1,
    );
  });

  it("報告に入力の値を含めない", () => {
    const marker = "目印XYZ";
    const marked = diagram({ edges: [{ from: marker, to: "a" }] });
    const data = curriculum([
      unit({
        title: 1,
        sections: [section({ id: marker }), section({ id: "two", diagram: marked })],
        questionIds: [marker],
        summary: [1, marker.repeat(100)],
        stages: [{ order: marker, questionIds: [marker] }],
      }),
    ]);
    const errors = validateCurriculumData(files(data), context);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).not.toContain(marker);
  });
});
