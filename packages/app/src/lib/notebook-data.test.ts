import { describe, expect, it } from "vitest";
import { findPublishedExam } from "./exam-data.ts";
import {
  buildToc,
  loadNotebook,
  type NotebookEntry,
  type NotebookUnit,
  neighborEntries,
  neighborUnits,
  sortNotebook,
  splitKeyPhrase,
  unitNumber,
  visibleEntries,
  visibleUnits,
} from "./notebook-data.ts";

const domains = [
  { code: "domain1", name: "分野 1", weight: 0.4 },
  { code: "domain2", name: "分野 2", weight: 0.6 },
];
const unit = (domain: string, order: number): NotebookUnit => ({
  id: `${domain}-${order}`,
  domain,
  order,
  title: `${domain} の ${order}`,
  status: "verified",
});
const entry = (id: string, unitId: string, order: number, status: NotebookEntry["status"]): NotebookEntry => ({
  id,
  unit: unitId,
  order,
  term: id,
  oneLine: "一言です。",
  diagram: {
    type: "flow",
    title: "図",
    nodes: [
      { id: "a", label: "入力" },
      { id: "b", label: "出力" },
    ],
    edges: [{ from: "a", to: "b" }],
  },
  body: "解説です。",
  checks: [
    {
      question: "問い",
      choices: [
        { key: "A", text: "正しい", reason: "理由" },
        { key: "B", text: "誤り", reason: "理由" },
      ],
      correct: "A",
    },
  ],
  references: [{ url: "https://docs.databricks.com/" }],
  status,
});

describe("体系ノートの並び", () => {
  it("中分類_資格マスタの分野の並び_分野の中の並び順に並べる(ファイルの並びによらない)", () => {
    const sorted = sortNotebook(domains, {
      units: [unit("domain2", 1), unit("domain1", 2), unit("domain1", 1)],
      entries: [entry("b", "domain1-1", 2, "verified"), entry("a", "domain1-1", 1, "verified")],
    });
    expect(sorted.units.map((u) => u.id)).toEqual(["domain1-1", "domain1-2", "domain2-1"]);
    expect(sorted.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("中分類の番号_分野の番号と並び順をつなぐ", () => {
    expect(unitNumber(domains, unit("domain2", 3))).toBe("2-3");
  });

  it("前後の中分類_端では null", () => {
    const units = [unit("domain1", 1), unit("domain1", 2), unit("domain2", 1)];
    expect(neighborUnits(units, "domain1-2")).toEqual({ prev: units[0], next: units[2] });
    expect(neighborUnits(units, "domain1-1").prev).toBeNull();
    expect(neighborUnits(units, "domain2-1").next).toBeNull();
  });
});

describe("公開の絞り込み", () => {
  const entries = [entry("a", "domain1-1", 1, "verified"), entry("b", "domain1-1", 2, "unverified")];

  it("利用者の画面_検証済みの見出しだけを出す", () => {
    expect(visibleEntries(entries, false).map((e) => e.id)).toEqual(["a"]);
  });

  it("管理者のプレビュー_未検証の見出しも出す", () => {
    expect(visibleEntries(entries, true).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("目次の節_絞り込みのあとの見出しの並びで 3 段にし_空の中分類は節を持たない", () => {
    const units = [unit("domain1", 1), unit("domain1", 2)];
    const all = [
      entry("b", "domain1-1", 2, "verified"),
      entry("a", "domain1-1", 1, "verified"),
      entry("x", "domain1-1", 3, "unverified"),
    ];
    const sorted = sortNotebook(domains, { units, entries: all }).entries;
    const toc = buildToc(domains, units, visibleEntries(sorted, false));
    expect(toc[0]?.units.map((u) => u.entries.map((e) => e.id))).toEqual([["a", "b"], []]);
    expect(toc[0]?.units[0]?.entries[0]).toEqual({ id: "a", term: "a" });
  });

  it("節の前後_同じ中分類の中の並びで_端では null", () => {
    const list = [
      entry("a", "domain1-1", 1, "verified"),
      entry("b", "domain1-1", 2, "verified"),
      entry("c", "domain1-1", 3, "verified"),
      entry("z", "domain1-2", 1, "verified"),
    ];
    expect(neighborEntries(list, "domain1-1", "b")).toEqual({ prev: list[0], next: list[2] });
    expect(neighborEntries(list, "domain1-1", "a").prev).toBeNull();
    expect(neighborEntries(list, "domain1-1", "c").next).toBeNull();
    expect(neighborEntries(list, "domain1-2", "zz")).toEqual({ prev: null, next: null });
  });

  it("目次の数_絞り込みのあとの見出しで数え_空の中分類は 0", () => {
    const units = [unit("domain1", 1), unit("domain1", 2), unit("domain2", 1)];
    const toc = buildToc(domains, units, visibleEntries(entries, false));
    expect(toc.map((d) => [d.number, d.count, d.filled, d.units.map((u) => u.count)])).toEqual([
      [1, 1, 1, [1, 0]],
      [2, 0, 0, [0]],
    ]);
    expect(buildToc(domains, units, visibleEntries(entries, true))[0]?.count).toBe(2);
  });

  it("未検証の中分類_利用者の画面では導入・図・表を外し_題と並びは残す", () => {
    const draft: NotebookUnit = {
      ...unit("domain1", 1),
      intro: "導入です。",
      diagram: { type: "hierarchy", title: "階層", root: { label: "根" } },
      comparison: { columns: ["a", "b"], rows: [{ aspect: "観点", cells: ["1", "2"] }] },
      status: "unverified",
    };
    const [shown] = visibleUnits([draft], false);
    expect(shown).toEqual({
      id: "domain1-1",
      domain: "domain1",
      order: 1,
      title: "domain1 の 1",
      status: "unverified",
    });
  });

  it("検証済みの中分類と管理者のプレビュー_導入・図・表をそのまま出す", () => {
    const done: NotebookUnit = { ...unit("domain1", 1), intro: "導入です。" };
    expect(visibleUnits([done], false)[0]?.intro).toBe("導入です。");
    const draft: NotebookUnit = { ...done, status: "unverified" };
    expect(visibleUnits([draft], true)[0]?.intro).toBe("導入です。");
  });
});

describe("一言の要点", () => {
  it("要点がある_前・要点・後に分ける", () => {
    expect(splitKeyPhrase("A は B で C。", "B で")).toEqual({ before: "A は ", key: "B で", after: " C。" });
  });

  it("要点がない・見つからない_全体を前に置く", () => {
    expect(splitKeyPhrase("一言。")).toEqual({ before: "一言。", key: "", after: "" });
    expect(splitKeyPhrase("一言。", "ない")).toEqual({ before: "一言。", key: "", after: "" });
  });
});

describe("体系ノートの読み込み", () => {
  it("DEA_中分類をすべて読み_分野の並び順に並べる", async () => {
    const exam = findPublishedExam("DBX-DEA-2605");
    if (!exam) throw new Error("DEA がありません");
    const notebook = await loadNotebook(exam);
    expect(notebook?.units).toHaveLength(33);
    expect(notebook?.units[0]?.id).toBe("domain1-1");
    expect(notebook?.units.at(-1)?.id).toBe("domain7-4");
  });

  it("ノートのない資格_null", async () => {
    const exam = findPublishedExam("EX-SMP-XX");
    if (!exam) throw new Error("サンプル資格がありません");
    expect(await loadNotebook(exam)).toBeNull();
  });
});
