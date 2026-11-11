import { existsSync, readFileSync } from "node:fs";
import { git } from "./git-check.ts";

/** 公開済みの内容の基準になる参照。取り込む側のコミットがこれに含まれるときだけ、公開済みとして扱う。 */
export const PUBLISHED_REF = "origin/main";

/** マージの途中で、検査の入力に出す内容。 */
export interface MergeNarrowing {
  /** 取り込む側(MERGE_HEAD)とも今の HEAD とも違う内容になったファイルだけの、結合した差分(`diff --combined`) */
  diff: string;
  /** 取り込む側と同じ内容になったファイル。公開済みとして、差分から省く */
  covered: string[];
}

const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** マージの途中で、取り込むコミットが 1 つだけのとき、その ID を返す。複数(オクトパスマージ)や、マージの途中でないときは null。 */
function incomingCommit(): string | null {
  const path = git(["rev-parse", "--path-format=absolute", "--git-path", "MERGE_HEAD"]).trim();
  if (!existsSync(path)) return null;
  const heads = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const [head] = heads;
  return heads.length === 1 && head !== undefined && OBJECT_ID.test(head) ? head : null;
}

function isPublished(commit: string): boolean {
  try {
    git(["merge-base", "--is-ancestor", commit, PUBLISHED_REF]);
    return true;
  } catch {
    return false; // 含まれない(終了コード 1)ときも、参照がない(128)ときも、公開済みとはみなさない
  }
}

function pathsOf(args: string[]): string[] {
  return git(["diff", "--cached", "--name-only", "--no-renames", "-z", ...args])
    .split("\0")
    .filter(Boolean);
}

/**
 * main を版のブランチに取り込むマージの途中(MERGE_HEAD がある)で、取り込む側が公開済み(PUBLISHED_REF に含まれる)のとき、
 * 検査の入力を、競合を解消した部分に絞る。
 * - 取り込む側と同じ内容になったファイルは、公開済みなので、差分から省いて一覧(covered)に挙げる。
 * - 取り込む側とも今の HEAD とも違う内容になったファイル(競合を解消したもの、両方の変更を自動で合わせたもの)の差分は、残す。
 * マージの途中でない、取り込む側が公開済みでない、競合が残っているなどで絞れないときは null(呼び出し側は、すべての差分を出す)。
 * 木を書き出す(`git write-tree`)ので、オブジェクトの置き場に未参照の木が 1 つ増える。参照・インデックス・作業ツリーは変えない。
 */
export function narrowMergeInput(): MergeNarrowing | null {
  const incoming = incomingCommit();
  if (incoming === null || !isPublished(incoming)) return null;
  const differsFromIncoming = new Set(pathsOf([incoming]));
  const covered = pathsOf([]).filter((path) => !differsFromIncoming.has(path));
  // 結合した差分は、マージの結果と 2 つの親を並べて出す。両方の親と違うファイルだけが出る
  const merged = git(["write-tree"]).trim();
  return { diff: git(["diff", "-c", merged, "HEAD", incoming]), covered };
}
