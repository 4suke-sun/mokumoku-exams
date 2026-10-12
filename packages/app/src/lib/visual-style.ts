import type { KeyValueStore } from "./storage.ts";

// 画面スタイル(リッチ / シンプル)。テーマ(ライト / ダーク)とは別の設定で、端末に保存する(docs/app/design-tone.md)。

export type VisualStyle = "rich" | "simple";

export const STYLE_CHOICES: { id: VisualStyle; label: string }[] = [
  { id: "rich", label: "リッチ" },
  { id: "simple", label: "シンプル" },
];

export const STYLE_KEY = "mokumoku:v1:style";

/** 既定はリッチ(これまでの演出のまま) */
export const DEFAULT_STYLE: VisualStyle = "rich";

/** 保存された値は外部入力として扱い、知らない値は既定にする。 */
export function parseStyle(raw: string | null | undefined): VisualStyle {
  return raw === "simple" ? "simple" : DEFAULT_STYLE;
}

export function loadStyle(store: KeyValueStore): VisualStyle {
  try {
    return parseStyle(store.getItem(STYLE_KEY));
  } catch {
    return DEFAULT_STYLE;
  }
}

export function saveStyle(store: KeyValueStore, style: VisualStyle): void {
  try {
    store.setItem(STYLE_KEY, style);
  } catch {
    // 保存が禁止されていても、その場の切り替えは有効にする
  }
}

/** 見た目は CSS の `data-style` で切り替える。演出の有無は、この属性を読んで決める。 */
export function applyStyle(root: HTMLElement, style: VisualStyle): void {
  root.setAttribute("data-style", style);
}

/**
 * 演出(カウントアップ、ゲージの動き、紙吹雪)を出すか。
 * 端末の「動きを減らす」設定が有効なときは、スタイルにかかわらず出さない。
 */
export function effectsEnabled(style: VisualStyle, reducedMotion: boolean): boolean {
  return style === "rich" && !reducedMotion;
}

/** 紙吹雪は、演出を出せて、合格ラインに届いた結果のときだけ出す。 */
export function shouldShowConfetti(style: VisualStyle, reducedMotion: boolean, reached: boolean): boolean {
  return reached && effectsEnabled(style, reducedMotion);
}

/**
 * 初回描画の前に実行して、スタイルの切り替わりによるちらつきを防ぐ。固定の文字列で、入力は含まない。
 * サーバーがアカウントの設定を反映したとき(`<html data-prefs>`)は、端末の値で上書きしない。
 */
export const STYLE_INIT_SCRIPT = `try{if(!document.documentElement.hasAttribute("data-prefs")){var s=localStorage.getItem(${JSON.stringify(STYLE_KEY)});document.documentElement.setAttribute("data-style",s==="simple"?"simple":"rich")}}catch(e){}`;
