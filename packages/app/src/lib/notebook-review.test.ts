import { describe, expect, it } from "vitest";
import type { NotebookEntry, TocDomain } from "./notebook-data.ts";
import {
  arrangeReview,
  choiceOrderOf,
  completableUnits,
  completedDateLabel,
  continueSection,
  currentOf,
  domainProgress,
  gradeReview,
  isEntryDone,
  type NotebookRecords,
  overallProgress,
  resumeEntryId,
  reviewItemsOf,
  tocSections,
  unitProgress,
} from "./notebook-review.ts";

const check = (correct: "A" | "B") => ({
  question: "問い",
  choices: [
    { key: "A" as const, text: "A の文", reason: "A の理由" },
    { key: "B" as const, text: "B の文", reason: "B の理由" },
  ],
  correct,
});
const entry = (id: string, unit: string, checks = [check("A")]) =>
  ({ id, unit, term: `用語 ${id}`, checks }) as unknown as NotebookEntry;

const toc: TocDomain[] = [
  {
    code: "domain1",
    number: 1,
    name: "分野 1",
    count: 3,
    filled: 2,
    units: [
      {
        id: "domain1-1",
        number: "1-1",
        title: "一",
        count: 2,
        entries: [
          { id: "a", term: "用語 a" },
          { id: "b", term: "用語 b" },
        ],
      },
      { id: "domain1-2", number: "1-2", title: "空", count: 0, entries: [] },
    ],
  },
  {
    code: "domain2",
    number: 2,
    name: "分野 2",
    count: 1,
    filled: 1,
    units: [{ id: "domain2-1", number: "2-1", title: "二", count: 1, entries: [{ id: "c", term: "用語 c" }] }],
  },
];

/** 決まった並びを返す乱数(テスト用) */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe("reviewItemsOf", () => {
  it("中分類の見出しの問いだけを_見出しの順と問いの順で集め_ID は見出しと問いの番号", () => {
    const items = reviewItemsOf(
      [entry("one", "domain1-1", [check("A"), check("B")]), entry("other", "domain2-1"), entry("two", "domain1-1")],
      "domain1-1",
    );
    expect(items.map((item) => item.id)).toEqual(["one-1", "one-2", "two-1"]);
    expect(items[0]?.term).toBe("用語 one");
  });
});

describe("choiceOrderOf と arrangeReview", () => {
  it("入れ替えない設定_A・B の順のまま", () => {
    expect(choiceOrderOf(false, () => 0)).toEqual(["A", "B"]);
  });

  it("入れ替える設定_乱数で B・A になりうる", () => {
    expect(choiceOrderOf(true, () => 0)).toEqual(["B", "A"]);
    expect(choiceOrderOf(true, () => 0.99)).toEqual(["A", "B"]);
  });

  it("おさらいの並び_問いの並びは指定のときだけ入れ替え_選択肢はいつも入れ替えの対象", () => {
    const items = reviewItemsOf([entry("one", "u"), entry("two", "u"), entry("three", "u")], "u");
    const kept = arrangeReview(items, () => 0, false);
    expect(kept.items.map((item) => item.id)).toEqual(["one-1", "two-1", "three-1"]);
    expect(kept.choiceOrder["one-1"]).toEqual(["B", "A"]);
    const moved = arrangeReview(items, sequence(0, 0), true);
    expect(moved.items.map((item) => item.id)).not.toEqual(["one-1", "two-1", "three-1"]);
    expect(moved.items).toHaveLength(3);
  });
});

describe("gradeReview", () => {
  const items = reviewItemsOf([entry("one", "u", [check("A")]), entry("two", "u", [check("B")])], "u");

  it("全問正解_allCorrect", () => {
    expect(gradeReview(items, { "one-1": "A", "two-1": "B" })).toEqual({ correct: 2, total: 2, allCorrect: true });
  });

  it("1 問でも誤りか未回答_allCorrect にならない", () => {
    expect(gradeReview(items, { "one-1": "A", "two-1": "A" }).allCorrect).toBe(false);
    expect(gradeReview(items, { "one-1": "A" })).toEqual({ correct: 1, total: 2, allCorrect: false });
  });

  it("問いがない_allCorrect にならない", () => {
    expect(gradeReview([], {}).allCorrect).toBe(false);
  });
});

const records = (units: Record<string, string> = {}, entries: Record<string, string> = {}): NotebookRecords => ({
  units: new Map(Object.entries(units)),
  entries: new Map(Object.entries(entries)),
});

describe("節の完了と履修済み", () => {
  it("節の完了_節の記録がある節と_旧い中分類の記録がある中分類のすべての節", () => {
    const r = records({ "domain2-1": "t" }, { "domain1-1#a": "t" });
    expect(isEntryDone(r, "domain1-1", "a")).toBe(true);
    expect(isEntryDone(r, "domain1-1", "b")).toBe(false);
    expect(isEntryDone(r, "domain2-1", "c")).toBe(true);
  });

  it("履修済み_すべての節が完了したときだけ_最も遅い完了の時刻を日付に使う", () => {
    const unit = toc[0]?.units[0];
    if (!unit) throw new Error("中分類がありません");
    expect(unitProgress(unit, records({}, { "domain1-1#a": "2026-10-01T00:00:00.000Z" }))).toMatchObject({
      done: 1,
      total: 2,
      completed: false,
      completedAt: undefined,
    });
    expect(
      unitProgress(
        unit,
        records({}, { "domain1-1#a": "2026-10-03T00:00:00.000Z", "domain1-1#b": "2026-10-02T00:00:00.000Z" }),
      ),
    ).toMatchObject({ done: 2, total: 2, completed: true, completedAt: "2026-10-03T00:00:00.000Z" });
  });

  it("旧い中分類の記録がある_全節を完了として数え_履修済みの時刻はその記録の時刻", () => {
    const unit = toc[0]?.units[0];
    if (!unit) throw new Error("中分類がありません");
    const progress = unitProgress(
      unit,
      records({ "domain1-1": "2026-09-01T00:00:00.000Z" }, { "domain1-1#a": "2026-10-03T00:00:00.000Z" }),
    );
    expect(progress).toMatchObject({ done: 2, total: 2, completed: true, completedAt: "2026-09-01T00:00:00.000Z" });
  });

  it("見出しのない中分類_履修済みにならない(旧い記録があっても)", () => {
    const empty = toc[0]?.units[1];
    if (!empty) throw new Error("中分類がありません");
    expect(unitProgress(empty, records({ "domain1-2": "t" })).completed).toBe(false);
  });

  it("ノートにない中分類・見出しの記録_数えない", () => {
    const r = records({ "domain9-9": "t" }, { "domain1-1#zzz": "t", "domain9-9#a": "t" });
    expect(overallProgress(toc, r)).toEqual({ doneEntries: 0, totalEntries: 3, doneUnits: 0, totalUnits: 2 });
  });

  it("全体と分野の数_分母は画面に出す節と見出しのある中分類", () => {
    const r = records({ "domain2-1": "t" }, { "domain1-1#a": "t" });
    expect(completableUnits(toc).map((u) => u.id)).toEqual(["domain1-1", "domain2-1"]);
    expect(overallProgress(toc, r)).toEqual({ doneEntries: 2, totalEntries: 3, doneUnits: 1, totalUnits: 2 });
    expect(domainProgress(toc[0] as TocDomain, r)).toEqual({ doneUnits: 0, totalUnits: 1 });
  });
});

describe("続きからと中分類の移し先", () => {
  it("節の並び_目次の順(見出しのない中分類は節を持たない)", () => {
    expect(tocSections(toc).map((s) => s.entry.id)).toEqual(["a", "b", "c"]);
  });

  it("続きから_目次の順で最初の完了していない節_すべて完了なら all-done", () => {
    expect(continueSection(toc, records())).toMatchObject({ entry: { id: "a" } });
    expect(continueSection(toc, records({}, { "domain1-1#a": "t" }))).toMatchObject({ entry: { id: "b" } });
    expect(continueSection(toc, records({ "domain1-1": "t" }))).toMatchObject({ entry: { id: "c" } });
    expect(continueSection(toc, records({ "domain1-1": "t", "domain2-1": "t" }))).toBe("all-done");
  });

  it("節がない_続きからは null", () => {
    expect(continueSection([], records())).toBeNull();
  });

  it("中分類の移し先_最初の完了していない節_すべて完了か読めないときは最初の節_節がなければ undefined", () => {
    const unit = toc[0]?.units[0];
    const empty = toc[0]?.units[1];
    if (!unit || !empty) throw new Error("中分類がありません");
    expect(resumeEntryId(unit, records({}, { "domain1-1#a": "t" }))).toBe("b");
    expect(resumeEntryId(unit, records({ "domain1-1": "t" }))).toBe("a");
    expect(resumeEntryId(unit, null)).toBe("a");
    expect(resumeEntryId(empty, records())).toBeUndefined();
  });

  it("URL からいまの中分類と節を読む_表紙と外の URL は未定義", () => {
    expect(currentOf("/exams/T/notebook/u1/e1", "/exams/T/notebook")).toEqual({ unit: "u1", entry: "e1" });
    expect(currentOf("/exams/T/notebook/u1", "/exams/T/notebook")).toEqual({ unit: "u1" });
    expect(currentOf("/exams/T/notebook", "/exams/T/notebook")).toEqual({});
    expect(currentOf("/exams/T/info", "/exams/T/notebook")).toEqual({});
  });

  it("履修した日_日本時間の日付_読めない時刻は空", () => {
    expect(completedDateLabel("2026-10-11T15:30:00.000Z")).toBe("2026/10/12");
    expect(completedDateLabel("昨日")).toBe("");
  });
});
