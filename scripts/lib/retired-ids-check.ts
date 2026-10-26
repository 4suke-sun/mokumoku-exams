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
/** 非公開の問題のファイル(data/unpublished.<コード>.json) */
const UNPUBLISHED_FILE = /^unpublished\.(.+)\.json$/;

export interface DataFileIds {
  name: string;
  ids: readonly string[];
}

/**
 * ファイル名と問題 ID の一覧から、検査に渡す一覧(questions.<コード>.json の名前ごと)を作る。
 * unpublished.<コード>.json の ID は、同じ資格の questions.<コード>.json の ID と合わせて数える
 * (公開と非公開のあいだの移動は、削除ではない。非公開のファイルから消えた ID は、削除として検査に残る)。
 */
export function buildSnapshot(files: readonly DataFileIds[]): QuestionsSnapshot {
  const out = new Map<string, Set<string>>();
  for (const { name, ids } of files) {
    const slug = (QUESTIONS_FILE.exec(name) ?? UNPUBLISHED_FILE.exec(name))?.[1];
    if (slug === undefined) continue;
    const key = `questions.${slug}.json`;
    const set = out.get(key) ?? new Set<string>();
    for (const id of ids) set.add(id);
    out.set(key, set);
  }
  return Object.fromEntries([...out].map(([key, set]) => [key, [...set]]));
}

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
