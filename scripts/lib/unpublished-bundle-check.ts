/**
 * 非公開の問題が、アプリのビルド成果物(配信に載るもの)に含まれないことの検査。
 * 非公開の問題(data/unpublished.<コード>.json)の設問文と ID を、成果物のファイルの中身から探す。
 * 報告は、ファイルのパスと問題の ID だけ(問題の本文は出さない)。
 */

export interface Probe {
  /** 非公開の問題の ID */
  id: string;
  /** 成果物から探す文字列(設問文の、そのままの形・JSON の文字列の形・\uXXXX にした形) */
  needles: string[];
}

/** JSON の文字列として埋め込まれたときの形(引用符・改行などを `\` で書く形) */
const jsonEscaped = (text: string): string => JSON.stringify(text).slice(1, -1);

/** ASCII 以外を `\uXXXX` で書いた形(バンドラが、日本語をこの形で出す場合がある) */
const unicodeEscaped = (text: string): string =>
  jsonEscaped(text).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** 探す設問文の長さ(これ未満の短い文字列は、偶然の一致が増えるので使わない) */
const MIN_TEXT = 12;

/** 非公開のファイルの中身(entries[].question)から、探す対象を作る。形が違う項目は飛ばす(形の検査は validate:data が行う) */
export function probesOf(file: unknown): Probe[] {
  const entries = (file as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    const q = (entry as { question?: { questionId?: unknown; questionText?: unknown } } | null)?.question;
    if (typeof q?.questionId !== "string") return [];
    const needles = [`"${q.questionId}"`];
    if (typeof q.questionText === "string" && q.questionText.length >= MIN_TEXT) {
      needles.push(q.questionText, jsonEscaped(q.questionText), unicodeEscaped(q.questionText));
    }
    return [{ id: q.questionId, needles: [...new Set(needles)] }];
  });
}

/** 1 つのファイルの中身に含まれる、非公開の問題の ID の一覧(重複なし) */
export function leakedIds(content: string, probes: readonly Probe[]): string[] {
  return probes.filter((p) => p.needles.some((needle) => content.includes(needle))).map((p) => p.id);
}
