import type { KeyValueStore } from "./storage.ts";

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "端末に従う" },
  { id: "light", label: "ライト" },
  { id: "dark", label: "ダーク" },
];

export const THEME_KEY = "mokumoku:v1:theme";

/** 保存された値は外部入力として扱い、知らない値は「端末に従う」にする。 */
export function parseTheme(raw: string | null): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function loadTheme(store: KeyValueStore): ThemeChoice {
  try {
    return parseTheme(store.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function saveTheme(store: KeyValueStore, choice: ThemeChoice): void {
  try {
    store.setItem(THEME_KEY, choice);
  } catch {
    // 保存が禁止されていても、その場の切り替えは有効にする
  }
}

/** `system` は属性を外し、CSS の prefers-color-scheme に任せる。 */
export function applyTheme(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/**
 * 初回描画の前に実行して、テーマの切り替わりによるちらつきを防ぐ。固定の文字列で、入力は含まない。
 * サーバーがアカウントの設定を反映したとき(`<html data-prefs>`)は、端末の値で上書きしない。
 */
export const THEME_INIT_SCRIPT = `try{if(!document.documentElement.hasAttribute("data-prefs")){var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}}catch(e){}`;
