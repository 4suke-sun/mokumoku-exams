import { describe, expect, it } from "vitest";
import { validateCurriculumData } from "./validate.ts";

const context = {
  questionIds: new Map([["EX-SMP-XX", new Set(["SAMPLE-0001", "SAMPLE-0002", "SAMPLE-0003"])]]),
  domains: new Map([["EX-SMP-XX", new Set(["domain1", "domain2"])]]),
};

const section = (over: Record<string, unknown> = {}) => ({
  id: "intro",
  title: "はじめに",
  body: "本文です。",
  ...over,
});
const unit = (over: Record<string, unknown> = {}) => ({
  id: "unit-one",
  title: "単元 1",
  domain: "domain1",
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
const domainSummaries = [{ code: "domain1", summary: "分野 1 の説明です。" }];
const curriculum = (units: unknown[] = [unit()], examCode = "EX-SMP-XX", domains: unknown[] = domainSummaries) => ({
  examCode,
  domains,
  units,
});
const files = (data: unknown = curriculum(), name = "curriculum.ex-smp-xx.json") => [{ name, data }];

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
    expect(errors).toEqual(["curriculum.ex-smp-xx.json: units[0].questionIds[0]: 問題データにない問題です"]);
  });

  it("別の資格の問題 ID_問題データにない問題として報告する", () => {
    const errors = validateCurriculumData(files(curriculum([unit({ questionIds: ["OTHER-0001"] })])), context);
    expect(errors).toEqual(["curriculum.ex-smp-xx.json: units[0].questionIds[0]: 問題データにない問題です"]);
  });

  it("単元の ID・単元の順番・節の ID・単元の中の問題 ID の重複_それぞれ報告する", () => {
    const dupUnit = validateCurriculumData(files(curriculum([unit(), unit({ order: 2 })])), context);
    expect(dupUnit).toEqual(["curriculum.ex-smp-xx.json: units[1].id: 単元の ID が重複しています"]);

    const dupOrder = validateCurriculumData(files(curriculum([unit(), unit({ id: "unit-two" })])), context);
    expect(dupOrder).toEqual(["curriculum.ex-smp-xx.json: units[1].order: 単元の順番が重複しています"]);

    const dupSection = validateCurriculumData(files(curriculum([unit({ sections: [section(), section()] })])), context);
    expect(dupSection).toEqual(["curriculum.ex-smp-xx.json: units[0].sections[1].id: 節の ID が重複しています"]);

    const dupQuestion = validateCurriculumData(
      files(curriculum([unit({ questionIds: ["SAMPLE-0001", "SAMPLE-0001"] })])),
      context,
    );
    expect(dupQuestion).toEqual(["curriculum.ex-smp-xx.json: units[0].questionIds[1]: 問題の ID が重複しています"]);
  });

  it("必須の項目がない・空・未知の項目_指摘する", () => {
    const { sections: _omit, ...noSections } = unit();
    expect(validateCurriculumData(files(curriculum([noSections])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([unit({ questionIds: [] })])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([])), context)).not.toEqual([]);
    expect(validateCurriculumData(files(curriculum([unit({ extra: 1 })])), context)).toHaveLength(1);
    expect(validateCurriculumData(files(curriculum([unit({ sections: [section({ body: "  " })] })])), context)).toEqual(
      ["curriculum.ex-smp-xx.json: units[0].sections[0].body: 形式が違います"],
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
        `curriculum.ex-smp-xx.json: ${path}: 本文に URL が含まれています`,
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
      "curriculum.ex-smp-xx.json: units[0].sections[0].references[0].url: 出典に許していないドメインの URL です",
      "curriculum.ex-smp-xx.json: units[0].sections[0].references[1].url: https で始まる URL ではありません",
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
    expect(validateCurriculumData(files(curriculum(), "curriculum.EX-SMP-XX.json"), context)).toEqual([
      "curriculum.EX-SMP-XX.json: ファイル名が curriculum.<コード(英小文字と数字)>.json の形ではありません",
    ]);
    expect(validateCurriculumData(files(curriculum(), "curriculum.ex-oth-xx.json"), context)).toEqual([
      "curriculum.ex-oth-xx.json: examCode がファイル名のコードと一致しません",
    ]);
  });

  it("公開中ではない資格・問題データのない資格のカリキュラム_指摘する", () => {
    const data = curriculum([unit({ questionIds: ["LATER-0001"] })], "EX-LTR-XX");
    expect(validateCurriculumData(files(data, "curriculum.ex-ltr-xx.json"), context)).toEqual([
      "curriculum.ex-ltr-xx.json: 公開中の資格(問題データのある資格)のカリキュラムではありません",
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
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.nodes[1].id: 図の箱の ID が重複しています",
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.edges[0]: 自分自身への矢印は置けません",
    ]);
    expect(validateCurriculumData(withDiagram({ edges: [{ from: "a", to: "x" }] }), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.edges[0].to: 図にない箱を指しています",
    ]);
  });

  it("図解の同じ向きの矢印の重複・閉路_指摘する", () => {
    const dup = [
      { from: "a", to: "b" },
      { from: "a", to: "b", label: "重複" },
    ];
    expect(validateCurriculumData(withDiagram({ edges: dup }), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.edges[1]: 同じ向きの矢印が重複しています",
    ]);
    const cycle = [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
      { from: "c", to: "a" },
    ];
    expect(validateCurriculumData(withDiagram({ edges: cycle }), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.edges: 矢印が一周して戻る形(閉路)になっています",
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
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.nodes[0].id: 形式が違います",
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.edges[0].to: 図にない箱を指しています",
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
    expect(missing).toEqual(["curriculum.ex-smp-xx.json: units[0].stages[0].questionIds[0]: 問題データにない問題です"]);

    const other = validateCurriculumData(
      files(curriculum([unit({ stages: [{ order: 1, questionIds: ["OTHER-0001"] }] })])),
      context,
    );
    expect(other).toEqual(["curriculum.ex-smp-xx.json: units[0].stages[0].questionIds[0]: 問題データにない問題です"]);

    const dup = validateCurriculumData(
      files(curriculum([unit({ stages: [{ order: 1, questionIds: ["SAMPLE-0001", "SAMPLE-0001"] }] })])),
      context,
    );
    expect(dup).toEqual(["curriculum.ex-smp-xx.json: units[0].stages[0].questionIds[1]: 問題の ID が重複しています"]);
  });

  it("段階の順番の重複・値の誤り・空の段階・未知の項目_指摘する", () => {
    const stage = (over: Record<string, unknown> = {}) => ({ order: 1, questionIds: ["SAMPLE-0001"], ...over });
    expect(validateCurriculumData(files(curriculum([unit({ stages: [stage(), stage()] })])), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].stages[1].order: 段階の順番が重複しています",
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

describe("分野と図の種類", () => {
  it("分野が複数_単元ごとに分野を持ち_すべての分野の説明がある_指摘なし", () => {
    const data = curriculum([unit(), unit({ id: "unit-two", order: 2, domain: "domain2" })], "EX-SMP-XX", [
      ...domainSummaries,
      { code: "domain2", summary: "分野 2 の説明です。" },
    ]);
    expect(validateCurriculumData(files(data), context)).toEqual([]);
  });

  it("単元の分野が資格マスタの分野にない_場所と種類だけを報告する", () => {
    const data = curriculum([unit({ domain: "domain9" })], "EX-SMP-XX", [{ code: "domain9", summary: "説明" }]);
    expect(validateCurriculumData(files(data), context)).toEqual([
      "curriculum.ex-smp-xx.json: domains[0].code: 資格マスタの分野にない分野です",
      "curriculum.ex-smp-xx.json: units[0].domain: 資格マスタの分野にない分野です",
    ]);
  });

  it("単元の分野が分野の説明にない・単元のない分野の説明_指摘する", () => {
    expect(validateCurriculumData(files(curriculum([unit({ domain: "domain2" })])), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].domain: 分野の説明(domains)にない分野です",
      "curriculum.ex-smp-xx.json: domains[0]: この分野の単元がありません",
    ]);
  });

  it("分野のコードの重複・形の誤り・単元の分野がない_指摘する", () => {
    const dup = curriculum([unit()], "EX-SMP-XX", [...domainSummaries, ...domainSummaries]);
    expect(validateCurriculumData(files(dup), context)).toEqual([
      "curriculum.ex-smp-xx.json: domains[1].code: 分野のコードが重複しています",
    ]);
    const badCode = curriculum([unit({ domain: "d1" })], "EX-SMP-XX", [{ code: "d1", summary: "説明" }]);
    expect(validateCurriculumData(files(badCode), context).length).toBeGreaterThan(0);
    const { domain: _omit, ...noDomain } = unit();
    expect(validateCurriculumData(files(curriculum([noDomain])), context).length).toBeGreaterThan(0);
  });

  it("単元の ID が分野の画面の経路と同じ_使えない", () => {
    expect(validateCurriculumData(files(curriculum([unit({ id: "domains" })])), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].id: この ID は、画面の経路に使うため使えません",
    ]);
  });

  const compare = (over: Record<string, unknown> = {}) => ({
    type: "compare",
    title: "比較",
    left: { heading: "左", items: [{ label: "項目", note: "説明" }] },
    right: { heading: "右", items: [{ label: "項目" }] },
    ...over,
  });
  const hierarchy = (over: Record<string, unknown> = {}) => ({
    type: "hierarchy",
    title: "階層",
    root: { label: "根", children: [{ label: "子", note: "説明", children: [{ label: "孫" }] }] },
    ...over,
  });
  const diagramFile = (d: unknown) => files(curriculum([unit({ sections: [section({ diagram: d })] })]));

  it("流れ・比較・階層の図_指摘なし", () => {
    expect(validateCurriculumData(diagramFile(compare()), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(hierarchy()), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile({ ...diagram(), type: "flow" }), context)).toEqual([]);
  });

  it("type のない図_type を省略すると流れの図になる", () => {
    expect(validateCurriculumData(diagramFile(diagram()), context)).toEqual([]);
    // 比較の図の形に type がなければ、流れの図として検査され、失敗する
    const { type: _omit, ...untyped } = compare();
    expect(validateCurriculumData(diagramFile(untyped), context).length).toBeGreaterThan(0);
  });

  it("知らない type・未知の項目_指摘する", () => {
    expect(validateCurriculumData(diagramFile({ ...compare(), type: "tree" }), context).length).toBeGreaterThan(0);
    expect(validateCurriculumData(diagramFile(compare({ extra: 1 })), context).length).toBeGreaterThan(0);
  });

  it("流れの図の箱の説明_40 文字まで", () => {
    const nodes = (note: string) => [
      { id: "a", label: "始め", note },
      { id: "b", label: "終わり" },
    ];
    const edges = [{ from: "a", to: "b" }];
    expect(validateCurriculumData(diagramFile(diagram({ nodes: nodes("あ".repeat(40)), edges })), context)).toEqual([]);
    expect(
      validateCurriculumData(diagramFile(diagram({ nodes: nodes("あ".repeat(41)), edges })), context),
    ).toHaveLength(1);
  });

  it("比較の図の項目が空・多すぎる・長すぎる_指摘する", () => {
    expect(validateCurriculumData(diagramFile(compare({ left: { heading: "左", items: [] } })), context)).toHaveLength(
      1,
    );
    const many = Array.from({ length: 7 }, () => ({ label: "項目" }));
    expect(
      validateCurriculumData(diagramFile(compare({ right: { heading: "右", items: many } })), context),
    ).toHaveLength(1);
    expect(
      validateCurriculumData(
        diagramFile(compare({ left: { heading: "あ".repeat(21), items: [{ label: "x" }] } })),
        context,
      ),
    ).toHaveLength(1);
    expect(
      validateCurriculumData(
        diagramFile(compare({ left: { heading: "左", items: [{ label: "項目", note: "あ".repeat(41) }] } })),
        context,
      ),
    ).toHaveLength(1);
  });

  const timeline = (over: Record<string, unknown> = {}) => ({
    type: "timeline",
    title: "時系列",
    events: [
      { id: "drop", label: "削除" },
      { id: "limit", label: "期限", note: "既定で 7 日" },
      { id: "purge", label: "ファイルが消える" },
    ],
    spans: [{ from: "drop", to: "limit", label: "戻せる期間" }],
    ...over,
  });
  const tableChange = (over: Record<string, unknown> = {}) => ({
    type: "table-change",
    title: "表の変化",
    operation: "MERGE INTO",
    before: {
      heading: "前",
      columns: [{ label: "id" }, { label: "値" }],
      rows: [{ cells: ["1", "a"] }, { cells: ["2", "b"], state: "removed" }],
    },
    after: {
      heading: "後",
      columns: [{ label: "id" }, { label: "値" }, { label: "日付", state: "added" }],
      rows: [
        { cells: ["1", "c", "1/1"], state: "changed" },
        { cells: ["3", "d", "1/2"], state: "added" },
      ],
    },
    ...over,
  });
  const where = "curriculum.ex-smp-xx.json: units[0].sections[0].diagram";

  it("時系列・表の変化・状態のある階層の図_指摘なし", () => {
    expect(validateCurriculumData(diagramFile(timeline()), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(tableChange()), context)).toEqual([]);
    const root = {
      label: "カタログ",
      children: [{ label: "スキーマ", state: "origin", children: [{ label: "表", state: "covered" }] }],
    };
    expect(validateCurriculumData(diagramFile(hierarchy({ root })), context)).toEqual([]);
  });

  it("時系列の期間が逆向き・図にない出来事・重なる_指摘する", () => {
    expect(
      validateCurriculumData(diagramFile(timeline({ spans: [{ from: "limit", to: "drop", label: "逆" }] })), context),
    ).toEqual([`${where}.spans[0]: 期間は、前の出来事から後の出来事へ向けます`]);
    expect(
      validateCurriculumData(diagramFile(timeline({ spans: [{ from: "drop", to: "none", label: "無" }] })), context),
    ).toEqual([`${where}.spans[0]: 図にない出来事を指しています`]);
    const overlap = [
      { from: "drop", to: "purge", label: "全体" },
      { from: "limit", to: "purge", label: "後半" },
    ];
    expect(validateCurriculumData(diagramFile(timeline({ spans: overlap })), context)).toEqual([
      `${where}.spans[1]: 期間どうしが重なっています`,
    ]);
    const touching = [
      { from: "drop", to: "limit", label: "前半" },
      { from: "limit", to: "purge", label: "後半" },
    ];
    expect(validateCurriculumData(diagramFile(timeline({ spans: touching })), context)).toEqual([]);
  });

  it("時系列の出来事の ID が重複_指摘する", () => {
    const events = [
      { id: "a", label: "一" },
      { id: "a", label: "二" },
    ];
    expect(validateCurriculumData(diagramFile(timeline({ events, spans: [] })), context)).toEqual([
      `${where}.events[1].id: 出来事の ID が重複しています`,
    ]);
  });

  it("表の変化の値の数が列と違う・状態の置き場が違う_指摘する", () => {
    const before = {
      heading: "前",
      columns: [{ label: "id", state: "added" }],
      rows: [{ cells: ["1", "x"], state: "added" }],
    };
    expect(validateCurriculumData(diagramFile(tableChange({ before })), context)).toEqual([
      `${where}.before.rows[0].cells: 値の数が列の数と違います`,
      `${where}.before.rows[0].state: 消した行は前の表に、足した行と変わった行は後の表に置きます`,
      `${where}.before.columns[0].state: 足した列は後の表に置きます`,
    ]);
    const after = { heading: "後", columns: [{ label: "id" }], rows: [{ cells: ["1"], state: "removed" }] };
    expect(validateCurriculumData(diagramFile(tableChange({ after })), context)).toEqual([
      `${where}.after.rows[0].state: 消した行は前の表に、足した行と変わった行は後の表に置きます`,
    ]);
  });

  it("表の変化のセルが長すぎる・URL を含む_指摘する", () => {
    const after = { heading: "後", columns: [{ label: "id" }], rows: [{ cells: ["あ".repeat(13)] }] };
    expect(validateCurriculumData(diagramFile(tableChange({ after })), context)).toHaveLength(1);
    const withUrl = { heading: "後", columns: [{ label: "id" }], rows: [{ cells: ["www.example"] }] };
    expect(validateCurriculumData(diagramFile(tableChange({ after: withUrl })), context)).toHaveLength(1);
  });

  it("階層の図の入れ子が深すぎる・箱が多すぎる_指摘する", () => {
    const nest = (depth: number): Record<string, unknown> =>
      depth === 1 ? { label: "葉" } : { label: `層${depth}`, children: [nest(depth - 1)] };
    expect(validateCurriculumData(diagramFile(hierarchy({ root: nest(4) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(hierarchy({ root: nest(5) })), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.root: 入れ子が深すぎます",
    ]);
    const wide = {
      label: "根",
      children: Array.from({ length: 4 }, (_, i) => ({
        label: `枝${i}`,
        children: Array.from({ length: 7 }, (_, j) => ({ label: `葉${i}-${j}` })),
      })),
    };
    expect(validateCurriculumData(diagramFile(hierarchy({ root: wide })), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.root: 階層の図の箱が多すぎます",
    ]);
  });

  it("階層の図の子が空の配列_指摘する", () => {
    const root = { label: "根", children: [] };
    expect(validateCurriculumData(diagramFile(hierarchy({ root })), context).length).toBeGreaterThan(0);
  });

  it("図の文字の URL_場所と種類だけを報告する", () => {
    const root = { label: "根", note: "https://example.com/" };
    expect(validateCurriculumData(diagramFile(hierarchy({ root })), context)).toEqual([
      "curriculum.ex-smp-xx.json: units[0].sections[0].diagram.root.note: 本文に URL が含まれています",
    ]);
  });

  const stepper = (over: Record<string, unknown> = {}) => ({
    type: "stepper",
    title: "手順",
    steps: [
      { id: "one", label: "最初", note: "はじめに行う" },
      { id: "two", label: "次" },
    ],
    ...over,
  });
  const toggle = (over: Record<string, unknown> = {}) => ({
    type: "toggle",
    title: "切り替え",
    states: [
      { id: "before", label: "操作の前" },
      { id: "after", label: "操作の後" },
    ],
    items: [
      { id: "a", label: "項目 A", note: "説明", result: { before: "kept", after: "removed" } },
      { id: "b", label: "項目 B", result: { before: "kept", after: "kept" } },
    ],
    ...over,
  });
  const decision = (over: Record<string, unknown> = {}) => ({
    type: "decision",
    title: "判断",
    nodes: [
      {
        id: "q1",
        question: "どちらですか",
        choices: [
          { label: "はい", to: "yes" },
          { label: "いいえ", to: "q2" },
        ],
      },
      { id: "yes", result: "結論 A", note: "理由" },
      {
        id: "q2",
        question: "さらに",
        choices: [
          { label: "はい", to: "yes" },
          { label: "いいえ", to: "no" },
        ],
      },
      { id: "no", result: "結論 B" },
    ],
    ...over,
  });

  it("手順・切り替え・判断の図_指摘なし", () => {
    expect(validateCurriculumData(diagramFile(stepper()), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(toggle()), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(decision()), context)).toEqual([]);
  });

  it("手順の図の段が 1 つ・9 つ_指摘する_2 つと 8 つは通る", () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `段${i}` }));
    expect(validateCurriculumData(diagramFile(stepper({ steps: steps(1) })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(stepper({ steps: steps(2) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(stepper({ steps: steps(8) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(stepper({ steps: steps(9) })), context)).toHaveLength(1);
  });

  it("手順の段の説明と見出しの文字数_上限ちょうどは通り_超えると指摘する", () => {
    const steps = (note: string, label: string) => [
      { id: "a", label, note },
      { id: "b", label: "次" },
    ];
    expect(
      validateCurriculumData(diagramFile(stepper({ steps: steps("あ".repeat(80), "あ".repeat(20)) })), context),
    ).toEqual([]);
    expect(validateCurriculumData(diagramFile(stepper({ steps: steps("あ".repeat(81), "段") })), context)).toHaveLength(
      1,
    );
    expect(
      validateCurriculumData(diagramFile(stepper({ steps: steps("説明", "あ".repeat(21)) })), context),
    ).toHaveLength(1);
  });

  it("手順の ID が重複・形式が違う_指摘する", () => {
    const dup = [
      { id: "a", label: "一" },
      { id: "a", label: "二" },
    ];
    expect(validateCurriculumData(diagramFile(stepper({ steps: dup })), context)).toEqual([
      `${where}.steps[1].id: 手順の ID が重複しています`,
    ]);
    const bad = [
      { id: "A", label: "一" },
      { id: "b", label: "二" },
    ];
    expect(validateCurriculumData(diagramFile(stepper({ steps: bad })), context)).toEqual([
      `${where}.steps[0].id: 形式が違います`,
    ]);
  });

  it("切り替えの図の項目が 0 件・9 件_指摘する_8 件は通る", () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `i${i}`,
        label: `項目${i}`,
        result: { before: "kept", after: "removed" },
      }));
    expect(validateCurriculumData(diagramFile(toggle({ items: items(0) })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(toggle({ items: items(8) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(toggle({ items: items(9) })), context)).toHaveLength(1);
  });

  it("切り替えの図の状態が 1 つ・3 つ_指摘する", () => {
    const state = (id: string) => ({ id, label: id });
    expect(validateCurriculumData(diagramFile(toggle({ states: [state("before")] })), context).length).toBeGreaterThan(
      0,
    );
    expect(
      validateCurriculumData(
        diagramFile(toggle({ states: [state("before"), state("after"), state("third")] })),
        context,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("切り替えの図の結果が、図にない状態・状態の不足・知らない値_指摘する", () => {
    const withResult = (result: unknown) => toggle({ items: [{ id: "a", label: "項目", result }] });
    expect(
      validateCurriculumData(diagramFile(withResult({ before: "kept", after: "kept", other: "removed" })), context),
    ).toEqual([`${where}.items[0].result: 図にない状態を指しています`]);
    expect(validateCurriculumData(diagramFile(withResult({ before: "kept" })), context)).toEqual([
      `${where}.items[0].result: 状態ごとの結果がそろっていません`,
    ]);
    expect(
      validateCurriculumData(diagramFile(withResult({ before: "kept", after: "gone" })), context).length,
    ).toBeGreaterThan(0);
  });

  it("切り替えの図の状態と項目の ID が重複_指摘する", () => {
    const states = [
      { id: "same", label: "一" },
      { id: "same", label: "二" },
    ];
    const items = [
      { id: "a", label: "項目", result: { same: "kept" } },
      { id: "a", label: "項目", result: { same: "kept" } },
    ];
    expect(validateCurriculumData(diagramFile(toggle({ states, items })), context)).toEqual([
      `${where}.states[1].id: 状態の ID が重複しています`,
      `${where}.items[1].id: 項目の ID が重複しています`,
    ]);
  });

  it("判断の図の選択肢が 1 つ・5 つ_指摘する", () => {
    const nodes = (n: number) => [
      { id: "q", question: "質問", choices: Array.from({ length: n }, (_, i) => ({ label: `選${i}`, to: "r" })) },
      { id: "r", result: "結論" },
    ];
    expect(validateCurriculumData(diagramFile(decision({ nodes: nodes(1) })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(decision({ nodes: nodes(2) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(decision({ nodes: nodes(4) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(decision({ nodes: nodes(5) })), context)).toHaveLength(1);
  });

  it("判断の図の節が 13 個_指摘する", () => {
    const chain = Array.from({ length: 13 }, (_, i) =>
      i < 12
        ? {
            id: `n${i}`,
            question: "質問",
            choices: [
              { label: "進む", to: `n${i + 1}` },
              { label: "戻る", to: `n${i + 1}` },
            ],
          }
        : { id: "n12", result: "結論" },
    );
    expect(validateCurriculumData(diagramFile(decision({ nodes: chain })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(decision({ nodes: chain.slice(1) })), context)).toEqual([]);
  });

  it("判断の図の質問と結論の文字数_上限ちょうどは通り_超えると指摘する", () => {
    const nodes = (question: string, result: string) => [
      {
        id: "q",
        question,
        choices: [
          { label: "あ".repeat(20), to: "r" },
          { label: "い", to: "r" },
        ],
      },
      { id: "r", result },
    ];
    expect(
      validateCurriculumData(diagramFile(decision({ nodes: nodes("あ".repeat(60), "い".repeat(60)) })), context),
    ).toEqual([]);
    expect(
      validateCurriculumData(diagramFile(decision({ nodes: nodes("あ".repeat(61), "結論") })), context),
    ).toHaveLength(1);
    expect(
      validateCurriculumData(diagramFile(decision({ nodes: nodes("質問", "い".repeat(61)) })), context),
    ).toHaveLength(1);
  });

  it("判断の図の行き先が図にない・自分自身_指摘する", () => {
    const missing = decision().nodes.map((n) =>
      n.id === "q1"
        ? {
            ...n,
            choices: [
              { label: "はい", to: "none" },
              { label: "いいえ", to: "q2" },
            ],
          }
        : n,
    );
    expect(validateCurriculumData(diagramFile(decision({ nodes: missing })), context)).toEqual([
      `${where}.nodes[0].choices[0].to: 図にない節を指しています`,
    ]);
    const self = decision().nodes.map((n) =>
      n.id === "q2"
        ? {
            ...n,
            choices: [
              { label: "はい", to: "q2" },
              { label: "いいえ", to: "no" },
            ],
          }
        : n,
    );
    expect(validateCurriculumData(diagramFile(decision({ nodes: self })), context)).toEqual([
      `${where}.nodes[2].choices[0]: 自分自身へは進めません`,
    ]);
  });

  it("判断の図の節の ID が重複・結論がない_指摘する", () => {
    const dup = [...decision().nodes, { id: "no", result: "重複" }];
    expect(validateCurriculumData(diagramFile(decision({ nodes: dup })), context)).toEqual([
      `${where}.nodes[4].id: 判断の節の ID が重複しています`,
    ]);
    const noResult = [
      {
        id: "q",
        question: "質問",
        choices: [
          { label: "a", to: "p" },
          { label: "b", to: "p" },
        ],
      },
      {
        id: "p",
        question: "質問",
        choices: [
          { label: "a", to: "q" },
          { label: "b", to: "q" },
        ],
      },
    ];
    expect(validateCurriculumData(diagramFile(decision({ nodes: noResult })), context)).toContain(
      `${where}.nodes: 結論の節が 1 つもありません`,
    );
  });

  it("判断の図に閉路・行き着けない節_指摘する", () => {
    const cycle = [
      {
        id: "q",
        question: "質問",
        choices: [
          { label: "a", to: "p" },
          { label: "b", to: "r" },
        ],
      },
      {
        id: "p",
        question: "質問",
        choices: [
          { label: "a", to: "q" },
          { label: "b", to: "r" },
        ],
      },
      { id: "r", result: "結論" },
    ];
    expect(validateCurriculumData(diagramFile(decision({ nodes: cycle })), context)).toEqual([
      `${where}.nodes: 選択肢が一周して戻る形(閉路)になっています`,
    ]);
    const orphan = [...decision().nodes, { id: "lost", result: "孤立" }];
    expect(validateCurriculumData(diagramFile(decision({ nodes: orphan })), context)).toEqual([
      `${where}.nodes[4]: 先頭の節から行き着けない節があります`,
    ]);
  });

  it("新しい 3 種類の図に未知の項目_指摘する", () => {
    expect(validateCurriculumData(diagramFile(stepper({ extra: 1 })), context).length).toBeGreaterThan(0);
    expect(validateCurriculumData(diagramFile(toggle({ extra: 1 })), context).length).toBeGreaterThan(0);
    expect(validateCurriculumData(diagramFile(decision({ extra: 1 })), context).length).toBeGreaterThan(0);
  });

  const dataflow = (over: Record<string, unknown> = {}) => ({
    type: "dataflow",
    title: "取り込みの流れ",
    nodes: [
      { id: "src", label: "取り込み", note: "ファイルが届く" },
      { id: "flt", label: "フィルター", filter: true },
      { id: "out", label: "保存" },
    ],
    edges: [
      { from: "src", to: "flt" },
      { from: "flt", to: "out" },
    ],
    ...over,
  });
  const layers = (over: Record<string, unknown> = {}) => ({
    type: "layers",
    title: "層",
    layers: [
      { id: "base", label: "基盤", note: "いちばん下", items: ["保管", "計算"] },
      { id: "top", label: "利用" },
    ],
    ...over,
  });

  it("データの流れ・層の図_指摘なし", () => {
    expect(validateCurriculumData(diagramFile(dataflow()), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(layers()), context)).toEqual([]);
  });

  it("データの流れの箱が 1 つ・9 つ_指摘する_2 つと 8 つは通る", () => {
    const nodes = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `箱${i}` }));
    const chain = (n: number) => Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` }));
    const run = (n: number) =>
      validateCurriculumData(diagramFile(dataflow({ nodes: nodes(n), edges: chain(n) })), context);
    expect(run(2)).toEqual([]);
    expect(run(8)).toEqual([]);
    expect(run(9)).toHaveLength(1);
    expect(
      validateCurriculumData(diagramFile(dataflow({ nodes: nodes(1), edges: [{ from: "n0", to: "n0" }] })), context)
        .length,
    ).toBeGreaterThan(0);
  });

  it("データの流れの矢印が 0 件・17 件_指摘する", () => {
    expect(validateCurriculumData(diagramFile(dataflow({ edges: [] })), context)).toHaveLength(1);
    const nodes = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, label: `箱${i}` }));
    const edges = nodes.flatMap((a, i) => nodes.slice(i + 1).map((b) => ({ from: a.id, to: b.id })));
    expect(edges.length).toBeGreaterThan(16);
    expect(validateCurriculumData(diagramFile(dataflow({ nodes, edges: edges.slice(0, 16) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(dataflow({ nodes, edges: edges.slice(0, 17) })), context)).toHaveLength(
      1,
    );
  });

  it("データの流れの矢印が図にない箱・自分自身_指摘する", () => {
    expect(validateCurriculumData(diagramFile(dataflow({ edges: [{ from: "src", to: "nothing" }] })), context)).toEqual(
      [`${where}.edges[0].to: 図にない箱を指しています`],
    );
    expect(validateCurriculumData(diagramFile(dataflow({ edges: [{ from: "src", to: "src" }] })), context)).toEqual([
      `${where}.edges[0]: 自分自身への矢印は置けません`,
    ]);
  });

  it("データの流れの箱の ID と矢印が重複_指摘する", () => {
    const nodes = [
      { id: "a", label: "一" },
      { id: "a", label: "二" },
    ];
    expect(
      validateCurriculumData(diagramFile(dataflow({ nodes, edges: [{ from: "a", to: "a" }] })), context),
    ).toContain(`${where}.nodes[1].id: 図の箱の ID が重複しています`);
    const edges = [
      { from: "src", to: "flt" },
      { from: "src", to: "flt" },
    ];
    expect(validateCurriculumData(diagramFile(dataflow({ edges })), context)).toEqual([
      `${where}.edges[1]: 同じ向きの矢印が重複しています`,
    ]);
  });

  it("データの流れの矢印が閉路_指摘する", () => {
    const edges = [
      { from: "src", to: "flt" },
      { from: "flt", to: "out" },
      { from: "out", to: "src" },
    ];
    expect(validateCurriculumData(diagramFile(dataflow({ edges })), context)).toEqual([
      `${where}.edges: 矢印が一周して戻る形(閉路)になっています`,
    ]);
  });

  it("データの流れの箱の文字数と絞り込みの値_上限ちょうどは通り_超える・真偽値でないは指摘する", () => {
    const node = (over: Record<string, unknown>) => [
      { id: "a", label: "あ".repeat(20), note: "い".repeat(40), ...over },
      { id: "b", label: "次" },
    ];
    const edges = [{ from: "a", to: "b" }];
    expect(validateCurriculumData(diagramFile(dataflow({ nodes: node({}), edges })), context)).toEqual([]);
    expect(
      validateCurriculumData(diagramFile(dataflow({ nodes: node({ label: "あ".repeat(21) }), edges })), context),
    ).toHaveLength(1);
    expect(
      validateCurriculumData(diagramFile(dataflow({ nodes: node({ note: "い".repeat(41) }), edges })), context),
    ).toHaveLength(1);
    expect(
      validateCurriculumData(diagramFile(dataflow({ nodes: node({ filter: "yes" }), edges })), context).length,
    ).toBeGreaterThan(0);
  });

  it("層の図の層が 1 つ・7 つ_指摘する_2 つと 6 つは通る", () => {
    const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}`, label: `層${i}` }));
    expect(validateCurriculumData(diagramFile(layers({ layers: list(1) })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(layers({ layers: list(2) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(layers({ layers: list(6) })), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(layers({ layers: list(7) })), context)).toHaveLength(1);
  });

  it("層の図の中身の語句が 0 件・9 件_指摘する_8 件と省略は通る", () => {
    const withItems = (items: unknown) =>
      layers({
        layers: [
          { id: "a", label: "一", items },
          { id: "b", label: "二" },
        ],
      });
    const words = (n: number) => Array.from({ length: n }, (_, i) => `語${i}`);
    expect(validateCurriculumData(diagramFile(withItems(words(8))), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(withItems(undefined)), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(withItems(words(0))), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(withItems(words(9))), context)).toHaveLength(1);
  });

  it("層の図の文字数_上限ちょうどは通り_超えると指摘する", () => {
    const layer = (over: Record<string, unknown>) =>
      layers({
        layers: [
          { id: "a", label: "あ".repeat(20), note: "い".repeat(80), items: ["う".repeat(20)], ...over },
          { id: "b", label: "二" },
        ],
      });
    expect(validateCurriculumData(diagramFile(layer({})), context)).toEqual([]);
    expect(validateCurriculumData(diagramFile(layer({ label: "あ".repeat(21) })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(layer({ note: "い".repeat(81) })), context)).toHaveLength(1);
    expect(validateCurriculumData(diagramFile(layer({ items: ["う".repeat(21)] })), context)).toHaveLength(1);
  });

  it("層の図の ID が重複・形式が違う_指摘する", () => {
    const dup = [
      { id: "a", label: "一" },
      { id: "a", label: "二" },
    ];
    expect(validateCurriculumData(diagramFile(layers({ layers: dup })), context)).toEqual([
      `${where}.layers[1].id: 層の ID が重複しています`,
    ]);
    const bad = [
      { id: "A", label: "一" },
      { id: "b", label: "二" },
    ];
    expect(validateCurriculumData(diagramFile(layers({ layers: bad })), context)).toEqual([
      `${where}.layers[0].id: 形式が違います`,
    ]);
  });

  it("データの流れと層の図に未知の項目_指摘する", () => {
    expect(validateCurriculumData(diagramFile(dataflow({ extra: 1 })), context).length).toBeGreaterThan(0);
    expect(validateCurriculumData(diagramFile(layers({ extra: 1 })), context).length).toBeGreaterThan(0);
  });
});
