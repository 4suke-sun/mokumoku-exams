import type { Question } from "./types.ts";

// 管理者のプレビューの絞り込み。画面から切り離した純粋な関数にして、単体テストする。

export type PreviewFilter = {
  /** 分野のコード。空なら、すべての分野 */
  domains: readonly string[];
  /** 難易度。空なら、すべて。"none" は、難易度のない問題 */
  difficulties: readonly (NonNullable<Question["difficulty"]> | "none")[];
  /** 問題の種類。空なら、すべて */
  types: readonly Question["questionType"][];
  /** 問題 ID か、問題文・解説に含む語。空なら、絞らない(全角・半角、大文字・小文字は区別しない) */
  keyword: string;
};

export const EMPTY_FILTER: PreviewFilter = { domains: [], difficulties: [], types: [], keyword: "" };

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();

/** 絞り込む。並びは、元の並びのまま。 */
export function filterQuestions(questions: readonly Question[], filter: PreviewFilter): Question[] {
  const keyword = normalize(filter.keyword.trim());
  return questions.filter((q) => {
    if (filter.domains.length > 0 && !filter.domains.includes(q.domain)) return false;
    if (filter.difficulties.length > 0 && !filter.difficulties.includes(q.difficulty ?? "none")) return false;
    if (filter.types.length > 0 && !filter.types.includes(q.questionType)) return false;
    if (keyword === "") return true;
    return normalize(`${q.questionId}\n${q.questionText}\n${q.explanation}`).includes(keyword);
  });
}

/** 1 ページに出す問題の数 */
export const PREVIEW_PAGE_SIZE = 20;

/** ページの数(結果が 0 件でも 1 ページ) */
export function pageCount(total: number, size: number = PREVIEW_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** ページ(0 始まり)の範囲に収めた番号 */
export function clampPage(page: number, total: number, size: number = PREVIEW_PAGE_SIZE): number {
  return Math.min(Math.max(0, page), pageCount(total, size) - 1);
}
