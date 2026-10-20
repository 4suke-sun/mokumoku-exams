import { describe, expect, it } from "vitest";
import { detectConflicts, mergeDuplicates, similarity } from "./dedupe.ts";
import { card, DOC_HASH } from "./test-helpers.ts";

const OTHER = {
  url: "https://docs.aws.amazon.com/guide/other.html",
  section: "Limits",
  anchor: { heading: "limits" },
  contentHash: DOC_HASH,
};

describe("重複のまとめ", () => {
  it("同じ主張(表記ゆれ・空白の違いを含む)_1 件にまとめ、出典をすべて残す。ID の小さいカードが残る", () => {
    const a = card({ id: "f-aaa" });
    const b = card({ id: "f-bbb", claim: a.claim.replace("Widget Store", "WIDGET  STORE"), sources: [OTHER] });
    const r = mergeDuplicates([b, a]);
    expect(r.merged).toBe(1);
    expect(r.cards.map((c) => c.id)).toEqual(["f-aaa"]);
    expect(r.cards[0]?.sources.map((s) => s.url)).toEqual([a.sources[0]?.url, OTHER.url]);
  });

  it("確度はまとめた先で低いほうに合わせ、試験ガイドの項目は和集合にする", () => {
    const r = mergeDuplicates([
      card({ id: "f-aaa", confidence: "high", scopeItems: [1] }),
      card({ id: "f-bbb", confidence: "low", scopeItems: [2], sources: [OTHER] }),
    ]);
    expect(r.cards[0]?.confidence).toBe("low");
    expect(r.cards[0]?.scopeItems).toEqual([1, 2]);
  });

  it("適用範囲・分野が違う_まとめない", () => {
    const r = mergeDuplicates([
      card({ id: "f-aaa", scope: { edition: "C01" } }),
      card({ id: "f-bbb", scope: { edition: "C02" }, sources: [OTHER] }),
      card({ id: "f-ccc", domain: "domain2", sources: [OTHER] }),
    ]);
    expect(r.merged).toBe(0);
    expect(r.cards).toHaveLength(3);
  });

  it("不採用のカード_まとめず、そのまま残す", () => {
    const r = mergeDuplicates([card({ id: "f-aaa" }), card({ id: "f-bbb", status: "rejected", reasons: ["x"] })]);
    expect(r.merged).toBe(0);
    expect(r.cards).toHaveLength(2);
  });
});

describe("矛盾の検出", () => {
  const a = card({
    id: "f-aaa",
    claim: "Widget Store では、アカウントがリージョンごとに持てるバケットは 100 個まで。",
  });
  const conflicting = (over: Parameters<typeof card>[0] = {}) =>
    card({
      id: "f-bbb",
      claim: "Widget Store では、アカウントがリージョンごとに持てるバケットは 200 個まで。",
      sources: [OTHER],
      ...over,
    });

  it("同じ適用範囲で、数値が食い違う_矛盾として検出する", () => {
    expect(detectConflicts([a, conflicting()])).toEqual([{ a: "f-aaa", b: "f-bbb" }]);
  });

  it("適用範囲が異なる(版による違い)_矛盾にならず、両方が残る", () => {
    expect(detectConflicts([a, conflicting({ scope: { edition: "C02" } })])).toEqual([]);
    expect(detectConflicts([a, conflicting({ scope: { edition: "C01", region: "eu-west-1" } })])).toEqual([]);
  });

  it("数値が同じ・主張が似ていない・固有名詞が違う・不採用_矛盾にならない", () => {
    expect(detectConflicts([a, conflicting({ claim: a.claim })])).toEqual([]);
    expect(
      detectConflicts([
        a,
        conflicting({ claim: "Widget Store のオブジェクトの上限サイズは 5 TB で、分割して送る場合も同じ。" }),
      ]),
    ).toEqual([]);
    expect(
      detectConflicts([
        a,
        conflicting({ claim: a.claim.replace("Widget Store", "Gadget Store").replace("100", "200") }),
      ]),
    ).toEqual([]);
    expect(detectConflicts([a, conflicting({ status: "rejected", reasons: ["x"] })])).toEqual([]);
  });

  it("主張の似かた_2 つ組の Jaccard 係数", () => {
    expect(similarity("abcd", "abcd")).toBe(1);
    expect(similarity("abcd", "wxyz")).toBe(0);
    expect(similarity("", "abcd")).toBe(0);
  });
});
