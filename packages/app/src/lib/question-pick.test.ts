import { describe, expect, it } from "vitest";
import { activeTargetOf, inDomains, inTarget, type PickItem, pickQuestions, targetQuestions } from "./question-pick.ts";

const item = (id: string, value: Partial<PickItem> = {}): PickItem => ({
  questionId: id,
  domain: "D1",
  questionType: "single",
  ...value,
});
const pool = [
  item("Q1", { difficulty: "easy" }),
  item("Q2", { difficulty: "hard", domain: "D2" }),
  item("Q3", { questionType: "free-text" }),
  item("Q4", { domain: "D2" }),
];
const lists = { review: ["Q2", "Q3", "GONE"], bookmarks: null };
const ids = (items: readonly PickItem[]) => items.map((p) => p.questionId);

describe("出題の対象の絞り込み", () => {
  it("モード_復習は復習プール_自由記述は全問_通常は選んだ対象", () => {
    expect(activeTargetOf("review", "bookmarks")).toBe("review");
    expect(activeTargetOf("free-text", "review")).toBe("all");
    expect(activeTargetOf("normal", "bookmarks")).toBe("bookmarks");
    expect(activeTargetOf(null, "review")).toBe("review");
  });

  it("対象の一覧_いまのデータにない問題は落とし_読み込めない一覧は空にする", () => {
    expect(ids(inTarget(pool, "normal", "review", lists))).toEqual(["Q2", "Q3"]);
    expect(ids(inTarget(pool, "normal", "bookmarks", lists))).toEqual([]);
    expect(ids(inTarget(pool, "free-text", "all", lists))).toEqual(["Q3"]);
  });

  it("難易度を選ぶ_その難易度の問題だけにし_難易度のない問題は出さない", () => {
    const options = { mode: "normal" as const, target: "all" as const, lists };
    expect(ids(targetQuestions(pool, { ...options, difficulties: [] }))).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(ids(targetQuestions(pool, { ...options, difficulties: ["easy", "hard"] }))).toEqual(["Q1", "Q2"]);
  });

  it("分野を選ぶ_その分野だけにし_選ばなければすべて", () => {
    expect(ids(inDomains(pool, ["D2"]))).toEqual(["Q2", "Q4"]);
    expect(ids(inDomains(pool, []))).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });
});

describe("出題の選び方", () => {
  it("優先しない_混ぜて問題数だけ選ぶ", () => {
    const picked = pickQuestions(pool, { count: 2, preferFewer: false, answerCounts: new Map(), random: () => 0 });
    expect(picked).toHaveLength(2);
    expect(new Set(ids(picked)).size).toBe(2);
  });

  it("解答回数の少ない問題を優先_回数 0 の問題を先に選ぶ", () => {
    const answerCounts = new Map([
      ["Q1", 10],
      ["Q2", 10],
      ["Q3", 0],
      ["Q4", 10],
    ]);
    const picked = pickQuestions(pool, { count: 1, preferFewer: true, answerCounts, random: () => 0.5 });
    expect(ids(picked)).toEqual(["Q3"]);
  });
});
