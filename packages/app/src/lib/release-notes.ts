import releaseNotesFile from "../../../../data/release-notes.json";
import type { Release } from "../../../../scripts/lib/release-notes-check.ts";

// リポジトリ直下の data/release-notes.json の静的な JSON を読む。形と並び(新しい版が先頭)は
// `npm run check:release-notes` が検査している。型だけを参照し、検査の処理は読み込まない(ADR 0004 と同じ方針)。

export type { Release };

/** 項目の種類の表示名 */
export const RELEASE_ITEM_LABELS: Record<string, string> = { feat: "機能", fix: "修正", docs: "文書", dev: "開発" };

/** リリースノートを、新しい版から順に返す。 */
export function listReleases(): readonly Release[] {
  return (releaseNotesFile as { releases: Release[] }).releases;
}
