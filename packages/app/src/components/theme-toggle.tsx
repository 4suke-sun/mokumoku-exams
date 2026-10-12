"use client";

import { pushPrefs } from "@/lib/prefs-client.ts";
import { browserStore } from "@/lib/storage.ts";
import { applyTheme, saveTheme, THEME_CHOICES, type ThemeChoice } from "@/lib/theme.ts";
import { useThemeChoice } from "@/lib/use-visual-style.ts";

/** 表示テーマの切り替え。選択は `<html data-theme>` に反映し、端末に保存して、アカウントにも送る。 */
export function ThemeToggle() {
  // 選択の正は <html data-theme>(サーバーが反映した設定と、初回描画の前のスクリプトが反映した端末の設定の、どちらも見る)
  const choice = useThemeChoice();

  function select(next: ThemeChoice) {
    applyTheme(document.documentElement, next);
    saveTheme(browserStore(), next);
    void pushPrefs();
  }

  return (
    <fieldset className="flex rounded-md border border-line text-sm">
      <legend className="sr-only">表示テーマ</legend>
      {THEME_CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={choice === c.id}
          onClick={() => select(c.id)}
          className={`px-2 py-1 first:rounded-l-md last:rounded-r-md ${
            choice === c.id ? "bg-primary font-bold text-on-primary" : "text-fg hover:bg-bg"
          }`}
        >
          {c.label}
        </button>
      ))}
    </fieldset>
  );
}
