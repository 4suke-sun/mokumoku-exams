/** 終わりに向かって減速する動き(0〜1 を 0〜1 に写す) */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * カウントアップの途中の値。`elapsedMs` が `durationMs` に達したら、`target` ちょうどを返す。
 * 途中の値は小数第 1 位に丸める(結果の割合の表示と同じ桁)。
 */
export function countUpValue(target: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return target;
  if (elapsedMs <= 0) return 0;
  return Math.round(target * easeOut(elapsedMs / durationMs) * 10) / 10;
}
