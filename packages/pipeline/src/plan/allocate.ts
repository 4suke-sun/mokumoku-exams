/**
 * 合計が total になる整数を、重みに比例して配る(最大剰余法)。
 * 端数の大きい順に 1 ずつ足し、同じ端数は先の項目を優先するので、同じ入力なら同じ結果になる。
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * total);
  const result = raw.map((r) => Math.floor(r + 1e-9));
  let rest = total - result.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - (result[i] as number) }))
    .filter((x) => weights[x.i] !== 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && order.length > 0; k++, rest--) {
    const target = order[k % order.length] as { i: number };
    result[target.i] = (result[target.i] as number) + 1;
  }
  return result;
}
