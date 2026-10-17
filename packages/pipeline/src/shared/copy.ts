import { compact, normalize } from "../text.ts";

/**
 * 本文の写しの検出(ADR 0006、docs/source-policy.md)。試験ガイドの言い換え、事実カードの主張、問題の下書きが、
 * 同じ関数(detectCopy)を使う。モデルを呼ばず、同じ入力なら同じ結果になる。一致した文字列そのものは、結果に含めない。
 *
 * - verbatim: 正規化(タグ・空白・全角半角・大文字小文字)をそろえたうえで、本文と連続して一致する長さが COPY_MAX_CHARS を超える。
 * - ordered-terms: 英語の本文を日本語に言い換えた文のように、文字の連続が一致しなくても、数値と固有名詞(ラテン文字の語)の並びが
 *   本文の近い範囲にそのままの順で現れる。数値・語が ORDERED_MIN_TOKENS 個以上ある文だけを見る(少ない文は、偶然の一致が多い)。
 */

/** この文字数を超える連続した一致を、本文の写しとみなす(直接の引用の上限と同じ) */
export const COPY_MAX_CHARS = 30;

/** 並びを見る文に必要な、数値と語の数の下限 */
export const ORDERED_MIN_TOKENS = 8;

/** 並びが現れる本文の範囲。文の数値・語の数に対する倍率(本文の語の数で数える) */
export const ORDERED_WINDOW_FACTOR = 4;

export type CopyKind = "verbatim" | "ordered-terms";

/** 数値(桁区切りは落とす)とラテン文字の語を、現れる順に取り出す */
export function orderedTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text
    .normalize("NFKC")
    .toLowerCase()
    .matchAll(/\d+(?:[.,]\d+)*|[a-z][a-z0-9.+_-]*/g)) {
    const token = m[0].replace(/,/g, "").replace(/[.+_-]+$/, "");
    if (token.length >= 2 || /\d/.test(token)) out.push(token);
  }
  return out;
}

/** text の中に、本文と連続して maxChars 文字を超えて一致する部分があるか */
function hasLongRun(text: string, haystack: string, maxChars: number): boolean {
  const chars = [...compact(text)];
  const window = maxChars + 1;
  if (chars.length < window) return false;
  for (let i = 0; i + window <= chars.length; i++) {
    if (haystack.includes(chars.slice(i, i + window).join(""))) return true;
  }
  return false;
}

/** 文の数値・語が、本文の近い範囲に、同じ順で現れるか(間に別の語が挟まってよい) */
function hasOrderedTerms(textTokens: readonly string[], bodyTokens: readonly string[]): boolean {
  const unique = new Set(textTokens);
  if (textTokens.length < ORDERED_MIN_TOKENS || unique.size < ORDERED_MIN_TOKENS / 2) return false;
  const limit = textTokens.length * ORDERED_WINDOW_FACTOR;
  const first = textTokens[0] as string;
  for (let start = 0; start < bodyTokens.length; start++) {
    if (bodyTokens[start] !== first) continue;
    let matched = 1;
    for (let i = start + 1; i < bodyTokens.length && i - start < limit && matched < textTokens.length; i++) {
      if (bodyTokens[i] === textTokens[matched]) matched++;
    }
    if (matched === textTokens.length) return true;
  }
  return false;
}

/**
 * text が bodies(本文)のどれかの写しか。連続一致を先に見て、なければ数値と語の並びを見る。写しでなければ null。
 * maxChars は連続一致の上限(既定は COPY_MAX_CHARS)。
 */
export function detectCopy(
  text: string,
  bodies: readonly string[],
  maxChars: number = COPY_MAX_CHARS,
): CopyKind | null {
  const tokens = orderedTokens(text);
  for (const body of bodies) {
    if (hasLongRun(text, compact(body), maxChars)) return "verbatim";
  }
  if (tokens.length < ORDERED_MIN_TOKENS) return null;
  for (const body of bodies) {
    if (hasOrderedTerms(tokens, orderedTokens(normalize(body)))) return "ordered-terms";
  }
  return null;
}
