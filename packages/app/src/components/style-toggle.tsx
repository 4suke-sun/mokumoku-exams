"use client";

import { changePrefs } from "@/lib/prefs-client.ts";
import { useVisualStyle } from "@/lib/use-visual-style.ts";
import { STYLE_CHOICES, type VisualStyle } from "@/lib/visual-style.ts";

/** 画面スタイル(リッチ / シンプル)の切り替え。選択は `<html data-style>` に反映し、端末に保存して、アカウントにも送る。 */
export function StyleToggle() {
  const style = useVisualStyle();

  function select(next: VisualStyle) {
    void changePrefs({ style: next });
  }

  return (
    <fieldset className="flex rounded-md border border-line text-sm">
      <legend className="sr-only">画面スタイル</legend>
      {STYLE_CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={style === c.id}
          onClick={() => select(c.id)}
          className={`px-2 py-1 first:rounded-l-md last:rounded-r-md ${
            style === c.id ? "bg-primary font-bold text-on-primary" : "text-fg hover:bg-bg"
          }`}
        >
          {c.label}
        </button>
      ))}
    </fieldset>
  );
}
