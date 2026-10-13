import { compact } from "../text.ts";

/**
 * 本文の長い写しの検出(ADR 0006、docs/source-policy.md)。
 * 正規化(タグ・空白・全角半角・大文字小文字)をそろえたうえで、本文と連続して一致する長さを調べる。
 * 入力は文字列だけで受けるので、事実カードにも、後の段階の問題の下書きにも使える。
 * 一致した文字列そのものは、結果に含めない。
 */

/** この文字数を超える連続した一致を、本文の写しとみなす(直接の引用の上限と同じ) */
export const COPY_MAX_CHARS = 30;

/** 本文の写しとして不採用にしたカードの主張に、代わりに入れる文。写しそのものを、コミットする台帳に残さない */
export const COPY_PLACEHOLDER = "本文の写しのため、内容は保存しない";

/** text の中に、本文と連続して maxChars 文字を超えて一致する部分があるか */
export function hasLongCopy(text: string, body: string, maxChars: number = COPY_MAX_CHARS): boolean {
  const chars = [...compact(text)];
  const window = maxChars + 1;
  if (chars.length < window) return false;
  const haystack = compact(body);
  for (let i = 0; i + window <= chars.length; i++) {
    if (haystack.includes(chars.slice(i, i + window).join(""))) return true;
  }
  return false;
}
