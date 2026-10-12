import { z } from "zod";
import { THEME_CHOICES, type ThemeChoice } from "./theme.ts";
import { STYLE_CHOICES, type VisualStyle } from "./visual-style.ts";

// アカウントに保存する表示の設定(テーマ、画面スタイル、選択肢のシャッフル)。端末をまたいで保ち、
// サーバーが最初の描画から反映する(Cookie に持つ。lib/prefs-cookie.ts)。値は外部入力として扱い、形を検査する。

export const THEME_VALUES = THEME_CHOICES.map((c) => c.id) as [ThemeChoice, ...ThemeChoice[]];
export const STYLE_VALUES = STYLE_CHOICES.map((c) => c.id) as [VisualStyle, ...VisualStyle[]];

export const PrefsSchema = z.strictObject({
  theme: z.enum(THEME_VALUES),
  style: z.enum(STYLE_VALUES),
  shuffleChoices: z.boolean(),
});
export type Prefs = z.infer<typeof PrefsSchema>;

export const DEFAULT_PREFS: Prefs = { theme: "system", style: "rich", shuffleChoices: false };

/** 設定の変更の本文の上限(3 つの値だけなので、小さい) */
export const MAX_PREFS_BODY_BYTES = 300;

export function prefsEqual(a: Prefs, b: Prefs): boolean {
  return a.theme === b.theme && a.style === b.style && a.shuffleChoices === b.shuffleChoices;
}
