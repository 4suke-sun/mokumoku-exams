/** 期限のこれだけ前に、トークンを更新する(秒) */
export const REFRESH_MARGIN_SECONDS = 300;

/** 期限(秒)の前の更新時刻までの待ち時間(ミリ秒)。期限が近い、または過ぎていれば 0。 */
export function refreshDelayMs(expSeconds: number, nowMs: number): number {
  return Math.max(0, (expSeconds - REFRESH_MARGIN_SECONDS) * 1000 - nowMs);
}
