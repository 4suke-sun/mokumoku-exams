/**
 * 本文と言い換えを比べるための正規化。タグを落とし、全角半角・大文字小文字・空白の違いをそろえる。
 */

/** よく使う文字参照(名前付きの一部と、数値の参照)を文字に戻す。知らない名前は、そのまま残す */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

export function normalize(text: string): string {
  return decodeEntities(text.replace(/<[^>]*>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** 正規化したうえで、空白をすべて落とす(語の区切りの違いを無視して、連続した文字列を比べる) */
export function compact(text: string): string {
  return normalize(text).replace(/\s/g, "");
}
