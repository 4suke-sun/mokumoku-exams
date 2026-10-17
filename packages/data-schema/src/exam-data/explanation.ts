/**
 * 解説の見出しの名前と、種類の対応(docs/data-spec.md の「6.1 解説の見出し」)。
 * アプリ(見出しごとのカードの表示)と作問パイプライン(下書きの解説の検査)が、同じ一覧を読む。
 * 表記ゆれは、データを直さず、ここの別名で吸収する。新しい見出しの名前を使うときは、ここと data-spec の表とテストに足す。
 */

/** 解説のカードの種類 */
export type ExplanationKind = "requirement" | "answer" | "knowledge" | "approach" | "summary" | "wrong" | "other";

/** 見出しの名前(コロンと前後の空白を除いたもの)と、種類の対応 */
export const HEADING_KINDS: Readonly<Record<string, ExplanationKind>> = {
  問われている要件: "requirement",
  要件: "requirement",
  正解の決め手: "answer",
  正解の理由: "answer",
  理由: "answer",
  前提知識: "knowledge",
  解くための考え方: "approach",
  考え方: "approach",
  まとめ: "summary",
  他の選択肢が誤りである理由: "wrong",
  他の選択肢が誤りの理由: "wrong",
  誤りの選択肢: "wrong",
};

/** 見出しの名前をそろえる(前後の空白と、末尾の半角・全角のコロンを除く) */
export function normalizeHeading(text: string): string {
  return text
    .trim()
    .replace(/[:：]\s*$/, "")
    .trim();
}

/** 段落が、決まった見出しの名前だけか。そうなら種類を返す */
export function headingKind(paragraph: string): ExplanationKind | null {
  const name = normalizeHeading(paragraph);
  return Object.hasOwn(HEADING_KINDS, name) ? (HEADING_KINDS[name] ?? null) : null;
}
