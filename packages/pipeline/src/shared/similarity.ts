import { compact } from "../text.ts";

/** 文字の 2 つ組(バイグラム)の集合。空白と全角半角・大文字小文字の違いはそろえ、サロゲートペアは 1 文字として数える。1 文字の文は、その 1 文字だけの集合 */
export function bigrams(text: string): Set<string> {
  const chars = [...compact(text)];
  if (chars.length < 2) return new Set(chars);
  const set = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) set.add((chars[i] as string) + (chars[i + 1] as string));
  return set;
}

function commonCount(x: Set<string>, y: Set<string>): number {
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return common;
}

/** 文字の 2 つ組の Dice 係数(0〜1)。同じ文は 1、共通の組がなければ 0。モデルを呼ばず、同じ入力なら同じ値になる */
export function dice(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  return (2 * commonCount(x, y)) / (x.size + y.size);
}

/** 文字の 2 つ組の Jaccard 係数(0〜1) */
export function jaccard(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  const both = commonCount(x, y);
  return both / (x.size + y.size - both);
}
