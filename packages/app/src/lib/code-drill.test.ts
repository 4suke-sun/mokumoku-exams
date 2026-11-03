import type { CodeDrillProblem } from "@mokumoku-exams/data-schema/code-drill-data/schema";
import { describe, expect, it } from "vitest";
import {
  clearFill,
  emptyFill,
  type Fragment,
  fillComplete,
  fragmentsOf,
  gradeFill,
  hintFill,
  judgeCode,
  placeFragment,
  removeFragment,
  templateParts,
  textHint,
  textHintSteps,
} from "./code-drill.ts";

const problem = {
  id: "SAMPLE-CD-0001",
  domain: "domain1",
  language: "sql",
  title: "行を絞る",
  prompt: "問い",
  template: "SELECT * FROM sales {{1}} amount {{2}} 100",
  blanks: [{ answer: "WHERE" }, { answer: ">" }],
  distractors: [
    { text: "HAVING", blank: 1, outcome: { kind: "error", text: "エラーになります。" } },
    { text: ">=", blank: 2, outcome: { kind: "different-result", text: "100 の行も入ります。" } },
  ],
  solutions: ["SELECT * FROM sales WHERE amount > 100", "SELECT * FROM sales WHERE 100 < amount"],
  mistakes: [
    { code: "SELECT * FROM sales WHERE amount >= 100", outcome: { kind: "different-result", text: "多い。" } },
  ],
  result: { text: "結果" },
  explanation: "解説",
  references: [{ title: "出典", url: "https://docs.databricks.com/" }],
  status: "verified",
} as CodeDrillProblem;

/** 並びを入れ替えない断片(テストで ID を決めて使う) */
const fragments: Fragment[] = [
  { id: "b1", text: "WHERE" },
  { id: "b2", text: ">" },
  { id: "d1", text: "HAVING" },
  { id: "d2", text: ">=" },
];

describe("穴埋めの操作", () => {
  it("断片を押す_先頭の空いた穴から順に埋まり_使った断片はもう入らない", () => {
    let state = placeFragment(emptyFill(problem), "d1");
    expect(state.placed).toEqual(["d1", null]);
    state = placeFragment(state, "d1");
    expect(state.placed).toEqual(["d1", null]);
    state = placeFragment(state, "b2");
    expect(state.placed).toEqual(["d1", "b2"]);
    expect(fillComplete(state)).toBe(true);
  });

  it("穴を外す_その穴が空に戻り_次の断片はそこに入る", () => {
    let state = placeFragment(placeFragment(emptyFill(problem), "d1"), "b2");
    state = removeFragment(state, 0);
    expect(state.placed).toEqual([null, "b2"]);
    expect(fillComplete(state)).toBe(false);
    expect(placeFragment(state, "b1").placed).toEqual(["b1", "b2"]);
  });

  it("すべてクリア_ヒントで埋めた穴だけを残す", () => {
    let state = hintFill(problem, fragments, emptyFill(problem));
    state = placeFragment(state, "d2");
    expect(clearFill(state)).toEqual({ placed: ["b1", null], hinted: [true, false] });
  });

  it("断片の一覧_正解と誤りのすべてを含む", () => {
    expect(
      fragmentsOf(problem, () => 0)
        .map((f) => f.text)
        .sort(),
    ).toEqual([">", ">=", "HAVING", "WHERE"]);
  });
});

describe("ヒント", () => {
  it("穴埋め_空か正解でない穴のうち最初の穴に正解を入れ_入っていた断片を外し_外せない印を付ける", () => {
    let state = placeFragment(emptyFill(problem), "d1");
    state = hintFill(problem, fragments, state);
    expect(state).toEqual({ placed: ["b1", null], hinted: [true, false] });
    expect(removeFragment(state, 0)).toBe(state);
    state = hintFill(problem, fragments, state);
    expect(state.placed).toEqual(["b1", "b2"]);
    expect(hintFill(problem, fragments, state)).toBe(state);
  });

  it("全文入力_1 回目は穴を伏せたコード_そのあとは穴を 1 つずつ明かす", () => {
    expect(textHint(problem, 0)).toBeNull();
    expect(textHint(problem, 1)).toBe("SELECT * FROM sales ［穴 1］ amount ［穴 2］ 100");
    expect(textHint(problem, 2)).toBe("SELECT * FROM sales WHERE amount ［穴 2］ 100");
    expect(textHint(problem, 3)).toBe("SELECT * FROM sales WHERE amount > 100");
    expect(textHintSteps(problem)).toBe(3);
  });
});

describe("採点", () => {
  it("穴埋め_誤りの穴にはその穴を狙った断片の実行するとどうなるかを返し_狙っていない断片は返さない", () => {
    const wrong = gradeFill(problem, fragments, { placed: ["d1", "b2"], hinted: [false, false] });
    expect(wrong.correct).toBe(false);
    expect(wrong.blanks[0]?.outcome?.kind).toBe("error");
    expect(wrong.blanks[1]?.correct).toBe(true);
    const swapped = gradeFill(problem, fragments, { placed: ["d2", "d1"], hinted: [false, false] });
    expect(swapped.blanks.map((b) => b.outcome)).toEqual([null, null]);
    expect(gradeFill(problem, fragments, { placed: ["b1", "b2"], hinted: [false, false] }).correct).toBe(true);
  });

  it("全文入力_正規化して正解か別解と完全一致すれば正解", () => {
    expect(judgeCode(problem, "select *\n  from sales\n  where amount > 100;").correct).toBe(true);
    expect(judgeCode(problem, "SELECT * FROM sales WHERE 100<amount").correct).toBe(true);
  });

  it("全文入力_正解の語を含むだけのコードは正解にならず_よくある誤りと一致したらその番号を返す", () => {
    expect(judgeCode(problem, "SELECT * FROM sales WHERE amount > 100 OR TRUE")).toEqual({
      correct: false,
      mistake: null,
    });
    expect(judgeCode(problem, "select * from sales where amount >= 100")).toEqual({ correct: false, mistake: 0 });
  });
});

describe("templateParts", () => {
  it("穴のあるコード_文字の部分と穴に分ける", () => {
    expect(templateParts("a {{1}} b {{2}}")).toEqual([
      { kind: "code", text: "a " },
      { kind: "blank", index: 0 },
      { kind: "code", text: " b " },
      { kind: "blank", index: 1 },
    ]);
  });
});
