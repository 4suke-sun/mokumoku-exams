import helpFile from "../../../../data/help.json";
import type { HelpFile, HelpSection } from "../../../../scripts/lib/help-data/schema.ts";

// リポジトリ直下の data/help.json の静的な JSON を読む。形とリンク先は `npm run validate:data` が検査している。
// 型だけを参照し、検査の処理は読み込まない(ADR 0004 と同じ方針)。

export type { HelpSection };

export function listHelpSections(): readonly HelpSection[] {
  return (helpFile as HelpFile).sections;
}
