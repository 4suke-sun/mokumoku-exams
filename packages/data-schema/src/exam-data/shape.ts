/**
 * 試験コード・問題 ID の形と、キーワードのならし方。zod に依存しない値だけを置く。
 * ブラウザで動く部品も読めるように、スキーマの定義(schema.ts)とは入口を分ける。
 */

/**
 * 試験コード: `<ベンダー略称>-<試験略称>-<版>`(すべて大文字と数字)。例: `AWS-AIB-C01`。
 * 公式に版の呼び名がない試験は、版を `XX` にする。ベンダー略称は `data/vendors.json` にあり、資格のベンダーと一致する。
 */
export const EXAM_CODE = /^[A-Z][A-Z0-9]{1,5}-[A-Z][A-Z0-9]{1,9}-[A-Z0-9]{2,4}$/;
/** 試験コードの最大の文字数(2〜6 文字、2〜10 文字、2〜4 文字と、区切りの 2 文字) */
export const EXAM_CODE_MAX_LENGTH = 22;

/** 問題 ID: `<問題 ID の接頭辞>-<4 桁の連番>`。接頭辞は資格マスタの `idPrefix` */
export const QUESTION_ID = /^[A-Z][A-Z0-9]{1,15}-\d{4}$/;
/** 問題 ID の最大の文字数(接頭辞 16 文字、区切り 1 文字、連番 4 桁) */
export const QUESTION_ID_MAX_LENGTH = 21;

/**
 * キーワードとの照合のために、全角・半角、大文字・小文字の違いをならし、空白を除く。
 * データの検査と、画面・サーバーの判定の両方が、この関数を使う。
 */
export function normalizeKeyword(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}
