import { describe, expect, it } from "vitest";
import { fewerAnsweredWeight, weightedSample } from "./weighted.ts";

/** 決まった並びの乱数(テストで結果を固定する) */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("fewerAnsweredWeight", () => {
  it("1/(1+回数)^2", () => {
    expect(fewerAnsweredWeight(0)).toBe(1);
    expect(fewerAnsweredWeight(1)).toBe(1 / 4);
    expect(fewerAnsweredWeight(2)).toBe(1 / 9);
  });
});

describe("weightedSample", () => {
  it("重複なしで_指定の数だけ選ぶ", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const picked = weightedSample(items, () => 1, 7, seeded(1));
    expect(picked).toHaveLength(7);
    expect(new Set(picked).size).toBe(7);
  });

  it("数が足りない_ある分だけ選ぶ", () => {
    expect(weightedSample([1, 2], () => 1, 5, seeded(1)).sort()).toEqual([1, 2]);
  });

  it("解答回数の少ない問題が_多い問題より選ばれやすい", () => {
    // 回数 0 の問題 5 つと、回数 3 の問題 5 つから、2 つを選ぶのを繰り返す
    const items = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `new-${i}`, count: 0 })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `old-${i}`, count: 3 })),
    ];
    const random = seeded(42);
    let fresh = 0;
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      for (const item of weightedSample(items, (it) => fewerAnsweredWeight(it.count), 2, random)) {
        if (item.count === 0) fresh++;
      }
    }
    // 重みは 1 と 1/16。回数 0 の問題が、選んだうちの 9 割を超える
    expect(fresh / (trials * 2)).toBeGreaterThan(0.9);
  });

  it("重みがすべて同じ_どれも同じくらい選ばれる", () => {
    const random = seeded(7);
    const counts = new Map<number, number>();
    for (let i = 0; i < 5000; i++) {
      const [picked] = weightedSample([0, 1, 2, 3], () => 1, 1, random);
      counts.set(picked as number, (counts.get(picked as number) ?? 0) + 1);
    }
    for (const n of [0, 1, 2, 3]) expect((counts.get(n) ?? 0) / 5000).toBeGreaterThan(0.2);
  });
});
