import { describe, expect, it } from "vitest";
import type { FactCard } from "../facts/schema.ts";
import { card } from "../facts/test-helpers.ts";
import { assignAnswerPositions, factSource, positionKey, requestKey, selectFacts } from "./request.ts";

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

  it("重みを渡す_使われていない数が同じなら、重みの小さいカードを、出典の偏りより先に選ぶ", () => {
    const cards = [cardFrom("f-00000000000a", URL_A), cardFrom("f-00000000000b", URL_B)];
    const priority = (c: FactCard) => (c.id === "f-00000000000a" ? 1 : 0);
    const selected = selectFacts(cards, new Map(), 1, new Map([[URL_B, 5]]), priority);
    expect(selected.map((c) => c.id)).toEqual(["f-00000000000b"]);
  });

  it("重みを渡す_まだ使われていないカードを、重みより先に選ぶ", () => {
    const cards = [cardFrom("f-00000000000a", URL_A), cardFrom("f-00000000000b", URL_B)];
    const priority = (c: FactCard) => (c.id === "f-00000000000a" ? 1 : 0);
    const selected = selectFacts(cards, new Map([["f-00000000000b", 1]]), 1, new Map(), priority);
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

describe("requestKey の論点の枠", () => {
  const base = {
    examCode: "AWS-AIB-C01",
    planItemId: "p-000000000001",
    count: 2,
    round: 0,
    facts: [{ id: "f-000000000001", claim: "架空の主張" }],
    definitionHash: "0".repeat(64),
  };

  it("問いの形の一言がない_鍵は論点の枠を足す前と変わらず_一言があると変わる", () => {
    expect(requestKey({ ...base, focusInstruction: undefined })).toBe(requestKey(base));
    expect(requestKey({ ...base, focusInstruction: "いまのレベルを選ばせる" })).not.toBe(requestKey(base));
    expect(requestKey({ ...base, focusInstruction: "いまのレベルを選ばせる" })).not.toBe(
      requestKey({ ...base, focusInstruction: "次の段階の取り組みを選ばせる" }),
    );
  });
});
