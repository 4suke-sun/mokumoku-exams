import { createHash } from "node:crypto";
import { decodeEntities } from "../text.ts";

/**
 * 出典の本文のハッシュ(ADR 0025)。出典の変更の検出と、キャッシュの鍵に使う。
 * HTML は、見える本文のハッシュにする(ページの飾りの更新で変わらない)。HTML でないものは、生のバイト列のハッシュのまま。
 */

/** 生のバイト列の sha256(16 進)。HTML でない本文と、旧い定義のキャッシュの名前の検証に使う */
export function rawSha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

const HTML_MARKER = /<(?:!doctype\s+html|html[\s>/]|head[\s>/]|body[\s>/])/i;
const SNIFF_BYTES = 4096;

/** 先頭の数 KB に HTML の目印がある本文を、HTML として扱う(取得時の Content-Type に依らず、本文だけで決まる) */
export function isHtml(body: Buffer): boolean {
  return HTML_MARKER.test(body.subarray(0, SNIFF_BYTES).toString("latin1"));
}

const HIDDEN_BLOCKS = /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/**
 * HTML の見える本文。`<main>` があれば、その中だけを取る(ナビゲーション・お知らせのバナー・フッターは、`<main>` の外にある)。
 * なければ、`<head>` を除いた全体を取る。コメント・script・style・noscript・template は除き、タグを外して、空白をそろえる。
 */
export function visibleText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, " ").replace(HIDDEN_BLOCKS, " ");
  const start = s.search(/<main[\s>/]/i);
  const end = [...s.matchAll(/<\/main\s*>/gi)].at(-1)?.index ?? -1;
  s = start >= 0 && end > start ? s.slice(start, end) : s.replace(/<head[\s>/][\s\S]*?<\/head\s*>/gi, " ");
  return decodeEntities(s.replace(/<[^>]*>/g, " "))
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/** 出典の本文のハッシュ。HTML は見える本文、それ以外は生のバイト列 */
export function contentHashOf(body: Buffer): string {
  return isHtml(body) ? rawSha256(visibleText(body.toString("utf8"))) : rawSha256(body);
}
