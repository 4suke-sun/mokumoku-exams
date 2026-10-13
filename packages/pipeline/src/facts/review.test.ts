import { describe, expect, it } from "vitest";
import { buildReview, renderReview, sampleCards, seededRandom } from "./review.ts";
import { card } from "./test-helpers.ts";

const many = [
  ...Array.from({ length: 8 }, (_, i) => card({ id: `f-a${i}`, domain: "domain1" })),
  ...Array.from({ length: 2 }, (_, i) => card({ id: `f-b${i}`, domain: "domain2" })),
  card({ id: "f-h", domain: "domain1", status: "held", reasons: ["conflict"] }),
  card({ id: "f-r1", domain: "domain2", status: "rejected", reasons: ["long-copy", "number-mismatch"] }),
  card({ id: "f-r2", domain: "domain2", status: "rejected", reasons: ["number-mismatch"] }),
];

describe("抜き取り", () => {
  it("分野ごとに最大の件数を選び、偏らない。通過したカードだけが対象", () => {
    const picked = sampleCards(many, 1, 3);
    expect(picked.filter((c) => c.domain === "domain1")).toHaveLength(3);
    expect(picked.filter((c) => c.domain === "domain2")).toHaveLength(2);
    expect(picked.every((c) => c.status === "passed")).toBe(true);
  });

  it("同じ入力と同じ種_同じ抜き取り。種を変えると変わりうる", () => {
    const ids = (seed: number) => sampleCards(many, seed, 3).map((c) => c.id);
    expect(ids(7)).toEqual(ids(7));
    expect(new Set([1, 2, 3, 4, 5, 6].map((s) => ids(s).join())).size).toBeGreaterThan(1);
  });

  it("入力の並びが違っても同じ抜き取り", () => {
    const ids = (cards: typeof many) => sampleCards(cards, 5, 3).map((c) => c.id);
    expect(ids([...many].reverse())).toEqual(ids(many));
  });

  it("乱数_同じ種なら同じ列", () => {
    const a = seededRandom(3);
    const b = seededRandom(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("レビューレポート", () => {
  const review = buildReview("AWS-AIB-C01", many, ["domain1", "domain2", "domain3"], 1, 3);

  it("件数・分野別・理由ごとの件数・抜き取りの表が載る", () => {
    expect(review.counts).toEqual({ total: 13, passed: 10, held: 1, rejected: 2 });
    expect(review.byDomain.find((d) => d.domain === "domain1")).toEqual({
      domain: "domain1",
      passed: 8,
      held: 1,
      rejected: 0,
    });
    expect(review.byReason).toEqual([
      { reason: "conflict", count: 1 },
      { reason: "long-copy", count: 1 },
      { reason: "number-mismatch", count: 2 },
    ]);
    expect(review.samples[0]).toMatchObject({
      domain: "domain1",
      url: expect.stringContaining("https://"),
      anchor: "quotas",
    });
  });

  it("本文や引用を含まない", () => {
    const text = JSON.stringify(review) + renderReview(review);
    expect(text).not.toContain("up to 100 buckets per account");
    expect(text).not.toContain("バケット");
    expect(text).toContain("| カード | 分野 | 出典 | 節 | アンカー |");
  });
});
