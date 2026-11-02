import { describe, expect, it } from "vitest";
import type { NotebookEntry, TocDomain } from "./notebook-data.ts";
import {
  arrangeReview,
  choiceOrderOf,
  completableUnits,
  completedCount,
  completedDateLabel,
  continueUnit,
  gradeReview,
  reviewItemsOf,
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
      { id: "domain1-1", number: "1-1", title: "一", count: 2 },
      { id: "domain1-2", number: "1-2", title: "空", count: 0 },
    ],
  },
  {
    code: "domain2",
    number: 2,
    name: "分野 2",
    count: 1,
    filled: 1,
    units: [{ id: "domain2-1", number: "2-1", title: "二", count: 1 }],
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

describe("履修済みの数と続きから", () => {
  it("見出しのない中分類は分母に入れず_ノートにない中分類の記録は数えない", () => {
    const units = completableUnits(toc);
    expect(units.map((unit) => unit.id)).toEqual(["domain1-1", "domain2-1"]);
    expect(
      completedCount(
        units,
        new Map([
          ["domain1-1", "t"],
          ["domain9-9", "t"],
        ]),
      ),
    ).toBe(1);
  });

  it("続きから_目次の順で最初の履修済みでない中分類_すべて済みなら all-done", () => {
    expect(continueUnit(toc, new Map())).toMatchObject({ id: "domain1-1" });
    expect(continueUnit(toc, new Map([["domain1-1", "t"]]))).toMatchObject({ id: "domain2-1" });
    expect(
      continueUnit(
        toc,
        new Map([
          ["domain1-1", "t"],
          ["domain2-1", "t"],
        ]),
      ),
    ).toBe("all-done");
  });

  it("履修済みにできる中分類がない_null", () => {
    expect(continueUnit([], new Map())).toBeNull();
  });

  it("履修した日_日本時間の日付_読めない時刻は空", () => {
    expect(completedDateLabel("2026-10-11T15:30:00.000Z")).toBe("2026/10/12");
    expect(completedDateLabel("昨日")).toBe("");
  });
});
