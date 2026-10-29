import { extractText, getDocumentProxy } from "unpdf";

/**
 * PDF の本文の読み取り。試験ガイドが PDF で公開される資格のため、抽出役が読めるテキストにする。
 * 本文のハッシュは、これまでどおり生のバイト列から取る(content-hash.ts)。テキストは、作業用のキャッシュの付属のファイルにだけ置く。
 */

/** 先頭のバイト列が PDF の印(`%PDF-`)か */
export function isPdf(body: Buffer): boolean {
  return body.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** PDF の本文をテキストにする。ページの区切りは空行 */
export async function pdfToText(body: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((page) => page.trim()).join("\n\n");
}
