import type { HelpFile, HelpItem, HelpLink, HelpSection } from "@mokumoku-exams/data-schema/help-data/schema";
import helpFile from "../../../../data/help.json";

// リポジトリ直下の data/help.json の静的な JSON を読む。形とリンク先は `npm run validate:data` が検査している。
// 型だけを参照し、検査の処理は読み込まない(データの契約は共有パッケージから読む。ADR 0011)。

export type { HelpItem, HelpLink, HelpSection };

export function listHelpSections(): readonly HelpSection[] {
  return (helpFile as HelpFile).sections;
}

/** 使い方の最終更新日(YYYY-MM-DD)。書いていなければ null。 */
export function helpUpdatedAt(): string | null {
  return (helpFile as HelpFile).updatedAt ?? null;
}
