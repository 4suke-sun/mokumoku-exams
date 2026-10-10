"use client";

import { useEffect, useState } from "react";
import { browserStore } from "@/lib/storage.ts";
import { applyTheme, loadTheme, saveTheme, THEME_CHOICES, type ThemeChoice } from "@/lib/theme.ts";

export function ThemeToggle() {
  // 初回描画はサーバーと同じ値にして、保存された選択は描画のあとに読む
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(loadTheme(browserStore()));
  }, []);

  function select(next: ThemeChoice) {
    setChoice(next);
    applyTheme(document.documentElement, next);
    saveTheme(browserStore(), next);
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
