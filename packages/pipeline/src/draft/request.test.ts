import { describe, expect, it } from "vitest";
import type { FactCard } from "../facts/schema.ts";
import { card } from "../facts/test-helpers.ts";
import { assignAnswerPositions, factSource, positionKey, selectFacts } from "./request.ts";

const URL_A = "https://docs.aws.amazon.com/guide/a.html";
const URL_B = "https://docs.aws.amazon.com/guide/b.html";
const URL_C = "https://docs.aws.amazon.com/guide/c.html";

/** 出典の URL だけを変えた事実カード */
function cardFrom(id: string, url: string): FactCard {
  const base = card({ id });
  return { ...base, sources: base.sources.map((s) => ({ ...s, url })) };
}

describe("事実カードの選び方", () => {
  it("同じ出典のカードが多い_出典を 1 巡ずつ回して選ぶ", () => {
    const cards = [
      cardFrom("f-00000000000a", URL_A),
      cardFrom("f-00000000000b", URL_A),
      cardFrom("f-00000000000c", URL_A),
      cardFrom("f-00000000000d", URL_B),
      cardFrom("f-00000000000e", URL_C),
    ];
    const selected = selectFacts(cards, new Map(), 4);
    expect(selected.slice(0, 3).map(factSource)).toEqual([URL_A, URL_B, URL_C]);
    expect(selected).toHaveLength(4);
  });

  it("根拠にされた回数が多い出典がある_使われていない出典のカードを先に選ぶ", () => {
    const cards = [cardFrom("f-00000000000a", URL_A), cardFrom("f-00000000000b", URL_B)];
    const selected = selectFacts(cards, new Map(), 1, new Map([[URL_A, 5]]));
    expect(selected.map((c) => c.id)).toEqual(["f-00000000000b"]);
  });

  it("カード自体が根拠にされている_出典の回数より先に_使われていないカードを選ぶ", () => {
    const cards = [cardFrom("f-00000000000a", URL_A), cardFrom("f-00000000000b", URL_B)];
    const selected = selectFacts(cards, new Map([["f-00000000000b", 1]]), 1, new Map([[URL_A, 5]]));
    expect(selected.map((c) => c.id)).toEqual(["f-00000000000a"]);
  });
});

describe("正答の位置の割り当て", () => {
  it("単一選択で偏りがある_使われていない記号から順に割り当てる", () => {
    const counts = new Map([
      ["A", 3],
      ["B", 5],
      ["C", 0],
      ["D", 1],
    ]);
    expect(assignAnswerPositions("single", 3, counts)).toEqual([["C"], ["C"], ["D"]]);
  });

  it("複数選択で同じ組が多い_使われていない組から割り当て_同じ組を続けない", () => {
    const counts = new Map([["BD", 14]]);
    const positions = assignAnswerPositions("multiple", 3, counts);
    expect(positions.map(positionKey)).not.toContain("BD");
    expect(new Set(positions.map(positionKey)).size).toBe(3);
  });

  it("割り当てた分_数に足され_次の割り当てに反映される", () => {
    const counts = new Map<string, number>();
    assignAnswerPositions("single", 4, counts);
    expect([...counts.values()]).toEqual([1, 1, 1, 1]);
  });
});
