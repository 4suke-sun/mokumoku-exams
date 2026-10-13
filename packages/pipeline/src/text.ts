/**
 * 本文と言い換えを比べるための正規化。タグを落とし、全角半角・大文字小文字・空白の違いをそろえる。
 */

export function normalize(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 正規化したうえで、空白をすべて落とす(語の区切りの違いを無視して、連続した文字列を比べる) */
export function compact(text: string): string {
  return normalize(text).replace(/\s/g, "");
}
