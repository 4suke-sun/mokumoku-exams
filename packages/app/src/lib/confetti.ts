/** 紙吹雪の 1 片。位置は画面の幅に対する割合、時間はミリ秒。 */
export type ConfettiPiece = {
  /** 左端からの位置(0〜100 %) */
  left: number;
  /** 落ち始めるまでの待ち */
  delayMs: number;
  /** 落ちきるまでの時間 */
  durationMs: number;
  /** 落ちる間の回転(度) */
  rotate: number;
  /** 色の番号(0 始まり。`colorCount` 未満) */
  color: number;
};

export const CONFETTI_COUNT = 40;
/** 満点のときは、量を増やす */
export const CONFETTI_PERFECT_COUNT = 80;
/** 最後の 1 片が落ちきる時間の上限。これを過ぎたら、紙吹雪を片付ける */
export const CONFETTI_TOTAL_MS = 3200;

const MAX_DELAY_MS = 600;
const MIN_DURATION_MS = 1800;
const MAX_DURATION_MS = CONFETTI_TOTAL_MS - MAX_DELAY_MS;

/** 紙吹雪の片を作る。乱数は差し替えられるようにして、テストで結果を固定する。 */
export function confettiPieces(count: number, colorCount: number, random: () => number): ConfettiPiece[] {
  return Array.from({ length: Math.max(0, count) }, () => ({
    left: Math.round(random() * 1000) / 10,
    delayMs: Math.round(random() * MAX_DELAY_MS),
    durationMs: Math.round(MIN_DURATION_MS + random() * (MAX_DURATION_MS - MIN_DURATION_MS)),
    rotate: Math.round((random() * 2 - 1) * 720),
    color: Math.min(colorCount - 1, Math.floor(random() * colorCount)),
  }));
}
