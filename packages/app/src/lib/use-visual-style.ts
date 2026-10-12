"use client";

import { useSyncExternalStore } from "react";
import { parseTheme, type ThemeChoice } from "./theme.ts";
import { DEFAULT_STYLE, parseStyle, type VisualStyle } from "./visual-style.ts";

// 画面スタイルと、端末の「動きを減らす」設定を、描画に使える形で読む。
// スタイルの正は `<html data-style>`(初回描画の前のスクリプトと、切り替えの部品が書く)。

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeStyle(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-style"] });
  return () => observer.disconnect();
}

function readStyle(): VisualStyle {
  return parseStyle(document.documentElement.getAttribute("data-style"));
}

/** 画面スタイル。サーバーでの描画では既定(リッチ)。 */
export function useVisualStyle(): VisualStyle {
  return useSyncExternalStore(subscribeStyle, readStyle, () => DEFAULT_STYLE);
}

function reduceQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia(REDUCE_QUERY) : null;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = reduceQuery();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** 端末の「動きを減らす」設定。サーバーでの描画では、動きを減らす側に倒す。 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => reduceQuery()?.matches ?? false,
    () => true,
  );
}

function subscribeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

/** テーマの選択。正は `<html data-theme>`(属性がなければ、端末に従う)。サーバーでの描画では「端末に従う」。 */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    subscribeTheme,
    () => parseTheme(document.documentElement.getAttribute("data-theme")),
    () => "system",
  );
}
