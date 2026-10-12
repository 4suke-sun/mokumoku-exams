/**
 * 解答回数の少ない問題を優先するときの重み。回数 0 の問題は 1、1 回は 1/4、2 回は 1/9 のように、回数が増えるほど選ばれにくくする。
 */
export function fewerAnsweredWeight(count: number): number {
  return 1 / (1 + Math.max(0, count)) ** 2;
}

/**
 * 重み付きの無作為抽出(重複なし)。それぞれに u^(1/w)(u は 0 より大きく 1 以下の乱数)の値を振り、大きい順に `count` 個を選ぶ。
 * 重みが大きいほど選ばれやすい。乱数は差し替えられるようにして、テストで結果を確かめる。
 */
export function weightedSample<T>(
  items: readonly T[],
  weight: (item: T) => number,
  count: number,
  random: () => number,
): T[] {
  const keyed = items.map((item) => {
    const w = Math.max(weight(item), Number.MIN_VALUE);
    // 0 の乱数は、どの重みでも 0 になって区別できないので、1 に寄せる
    const u = 1 - random();
    return { item, key: u ** (1 / w) };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, Math.max(0, count)).map((k) => k.item);
}
