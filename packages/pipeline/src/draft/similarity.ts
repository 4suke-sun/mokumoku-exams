import { compact } from "../text.ts";

/** 文字の 2 つ組(バイグラム)の集合。空白と全角半角・大文字小文字の違いはそろえる */
function bigrams(text: string): Set<string> {
  const c = compact(text);
  if (c.length < 2) return new Set(c === "" ? [] : [c]);
  const set = new Set<string>();
  for (let i = 0; i < c.length - 1; i++) set.add(c.slice(i, i + 2));
  return set;
}

/**
 * 2 つの文の類似度(0〜1)。文字のバイグラムの Dice 係数。モデルを呼ばず、同じ入力なら同じ値になる。
 * 同じ文は 1、共通の文字の組がなければ 0。
 */
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return (2 * common) / (x.size + y.size);
}
