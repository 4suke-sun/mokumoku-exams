import { describe, expect, it } from "vitest";
import { CONFETTI_TOTAL_MS, confettiPieces } from "./confetti.ts";

/** 決まった並びを返す乱数(テストで結果を固定する) */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("confettiPieces", () => {
  it("指定した数だけ作る_負の数は 0 個", () => {
    expect(confettiPieces(5, 3, Math.random)).toHaveLength(5);
    expect(confettiPieces(-1, 3, Math.random)).toHaveLength(0);
  });

  it("乱数の端の値でも_位置・時間・色の範囲に収まる", () => {
    for (const r of [0, 0.5, 0.999999]) {
      const [piece] = confettiPieces(1, 4, () => r);
      expect(piece?.left).toBeGreaterThanOrEqual(0);
      expect(piece?.left).toBeLessThanOrEqual(100);
      expect((piece?.delayMs ?? 0) + (piece?.durationMs ?? 0)).toBeLessThanOrEqual(CONFETTI_TOTAL_MS);
      expect(piece?.color).toBeGreaterThanOrEqual(0);
      expect(piece?.color).toBeLessThan(4);
      expect(Math.abs(piece?.rotate ?? 0)).toBeLessThanOrEqual(720);
    }
  });

  it("同じ乱数の並び_同じ片を作る", () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(confettiPieces(3, 5, sequence(values))).toEqual(confettiPieces(3, 5, sequence(values)));
  });
});
