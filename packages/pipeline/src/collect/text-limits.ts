/**
 * 言い換えと引用の長さの上限(docs/source-policy.md の「2. 言い換えと引用」)。
 * 日本語などを含む文は文字数で、英語の文は語数で数える。本文の長い写しを台帳に入れないための機械検査。
 */
export const PARAPHRASE_MAX_CHARS = 200;
export const PARAPHRASE_MAX_WORDS = 35;
export const QUOTE_MAX_CHARS = 30;
export const QUOTE_MAX_WORDS = 10;
export const QUOTES_TOTAL_MAX_CHARS = 100;

/** 英語の文として語数で数えるか(かな・漢字・ハングルを含まない文) */
function isWordCounted(text: string): boolean {
  return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text);
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** 文字数の上限を、語数で数える文にも置く(長い 1 語で上限をすり抜けないように) */
const CHARS_PER_WORD = 12;

export function withinParaphraseLimit(text: string): boolean {
  if (!isWordCounted(text)) return [...text].length <= PARAPHRASE_MAX_CHARS;
  return words(text) <= PARAPHRASE_MAX_WORDS && text.length <= PARAPHRASE_MAX_WORDS * CHARS_PER_WORD;
}

export function withinQuoteLimit(text: string): boolean {
  if (!isWordCounted(text)) return [...text].length <= QUOTE_MAX_CHARS;
  return words(text) <= QUOTE_MAX_WORDS && text.length <= QUOTE_MAX_WORDS * CHARS_PER_WORD;
}

export function withinQuotesTotal(quotes: readonly string[]): boolean {
  return quotes.reduce((sum, q) => sum + [...q].length, 0) <= QUOTES_TOTAL_MAX_CHARS;
}
