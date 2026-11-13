/**
 * 配信するデータ(`data/` の JSON)を変える PR が、新しい版のエントリ(`data/release-notes.json`)を伴うかの検査。
 * 純粋な関数だけを置く(git の読み取りは scripts/check-data-release.ts)。
 */
import { compareVersions } from "./release-notes-check.ts";

/**
 * アプリが配信する `data/` のファイル。直下の JSON のうち、リリースノート(版のエントリそのもの)と、
 * 非公開の問題(`unpublished.<コード>.json`。アプリは配信しない)を除く。
 */
export function isDeliveredData(path: string): boolean {
  return /^data\/[^/]+\.json$/.test(path) && path !== "data/release-notes.json" && !/^data\/unpublished\./.test(path);
}

export interface DataReleaseInput {
  /** PR の範囲で変わったファイルのパス(リポジトリのルートからの相対) */
  changedFiles: string[];
  /** 基準のブランチの、リリースノートの先頭の版。読めないときは null */
  baseTop: string | null;
  /** PR の先頭の、リリースノートの先頭の版。読めないときは null */
  headTop: string | null;
}

/** 止める理由の一覧(空なら通す)。値は書かず、ファイルのパスと版だけを書く。 */
export function checkDataRelease({ changedFiles, baseTop, headTop }: DataReleaseInput): string[] {
  const data = changedFiles.filter(isDeliveredData);
  if (data.length === 0) return [];
  if (headTop === null) return ["data/release-notes.json の先頭の版を読めません"];
  if (baseTop !== null && compareVersions(headTop, baseTop) <= 0) {
    return [
      `配信するデータ(${data.join("、")})を変える PR に、新しい版のエントリがありません。data/release-notes.json の先頭に、${baseTop} より新しい版を足してください`,
    ];
  }
  return [];
}
