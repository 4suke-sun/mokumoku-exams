/**
 * 削除した問題 ID の検査。基準(main)にあって今のファイルにない問題 ID は、資格マスタの retiredQuestionIds に入っていること。
 * 入っていないと、あとで同じ番号を採番しうる(問題 ID は、受験履歴・ブックマーク・復習が参照する。docs/data-spec.md の 7)。
 * 報告は、ファイル名と ID だけ(問題の本文は出さない)。
 */

export interface QuestionsSnapshot {
  /** questions.<コード>.json の名前ごとの、問題 ID の一覧 */
  [file: string]: readonly string[];
}

/** 資格コードごとの、退役した問題 ID */
export type RetiredIds = Readonly<Record<string, readonly string[]>>;

const QUESTIONS_FILE = /^questions\.(.+)\.json$/;

export function checkRemovedIds(
  base: QuestionsSnapshot,
  current: QuestionsSnapshot,
  retiredByExam: RetiredIds,
  examCodeOfFile: (file: string) => string | null,
): string[] {
  const errors: string[] = [];
  for (const [file, ids] of Object.entries(base)) {
    if (!QUESTIONS_FILE.test(file)) continue;
    const now = new Set(current[file] ?? []);
    const examCode = examCodeOfFile(file);
    const retired = new Set(examCode ? (retiredByExam[examCode] ?? []) : []);
    for (const id of ids) {
      if (!now.has(id) && !retired.has(id)) {
        errors.push(`${file}: 削除した問題 ID ${id} が、資格マスタの retiredQuestionIds にありません`);
      }
    }
  }
  return errors;
}
