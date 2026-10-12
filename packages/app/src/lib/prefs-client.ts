import { z } from "zod";
import { DEFAULT_PREFS, type Prefs, PrefsSchema, prefsEqual } from "./prefs.ts";
import { browserStore, type KeyValueStore, loadSettings, saveSettings } from "./storage.ts";
import { applyTheme, loadTheme, saveTheme, THEME_KEY } from "./theme.ts";
import { applyStyle, loadStyle, STYLE_KEY, saveStyle } from "./visual-style.ts";

// 表示の設定(テーマ・画面スタイル・シャッフル)の、端末とアカウントの同期。
// 端末(localStorage)は、ログイン前の画面と、アカウントに接続できないときの保存先。アカウントに保存した設定を、正とする。

const SETTINGS_KEY = "mokumoku:v1:settings";

/** この端末に、設定が 1 つでも保存されているか(既定のままの端末か、設定を選んだ端末かを分ける) */
export function hasLocalPrefs(store: KeyValueStore): boolean {
  try {
    return [THEME_KEY, STYLE_KEY, SETTINGS_KEY].some((key) => store.getItem(key) !== null);
  } catch {
    return false;
  }
}

/** この端末の設定(保存していない項目は、既定の値) */
export function readLocalPrefs(store: KeyValueStore): Prefs {
  return { theme: loadTheme(store), style: loadStyle(store), shuffleChoices: loadSettings(store).shuffleChoices };
}

/** 設定を、この端末の保存先と、いまの画面に反映する(解答の表示のしかたなど、設定以外の項目は変えない) */
export function applyPrefs(store: KeyValueStore, prefs: Prefs, root: HTMLElement = document.documentElement): void {
  saveTheme(store, prefs.theme);
  saveStyle(store, prefs.style);
  saveSettings(store, { ...loadSettings(store), shuffleChoices: prefs.shuffleChoices });
  applyTheme(root, prefs.theme);
  applyStyle(root, prefs.style);
}

const PrefsResponseSchema = z.object({ prefs: PrefsSchema.nullable() });

/** アカウントの設定。保存していなければ `{ prefs: null }`、取得できなければ null。 */
export async function fetchPrefs(): Promise<{ prefs: Prefs | null } | null> {
  try {
    const response = await fetch("/api/history/prefs", { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = PrefsResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** アカウントに設定を保存する。保存できたら true。 */
export async function putPrefs(prefs: Prefs): Promise<boolean> {
  try {
    const response = await fetch("/api/history/prefs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(prefs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * ログイン後の同期。
 * - アカウントに設定があれば、それを端末に反映する(別の端末で選んだ設定が、この端末でも使われる)。
 * - アカウントに設定がなく、この端末に設定があれば、初回にアカウントへ上げる。
 * - どちらにもなければ、何もしない(既定のまま)。
 * 取得できなかったとき(通信の失敗)は、何も変えない。戻り値は、端末の設定を書き換えたか。
 */
export async function syncPrefs(store: KeyValueStore = browserStore()): Promise<boolean> {
  const remote = await fetchPrefs();
  if (remote === null) return false;
  if (remote.prefs) {
    const changed = !prefsEqual(remote.prefs, readLocalPrefs(store));
    applyPrefs(store, remote.prefs);
    return changed;
  }
  if (hasLocalPrefs(store)) await putPrefs(readLocalPrefs(store));
  return false;
}

/** 端末の設定を変えたあとに、アカウントへ送る(失敗しても、端末の設定はそのまま。次の変更か、ログインで追いつく) */
export async function pushPrefs(store: KeyValueStore = browserStore()): Promise<void> {
  await putPrefs(readLocalPrefs(store));
}

export { DEFAULT_PREFS };
