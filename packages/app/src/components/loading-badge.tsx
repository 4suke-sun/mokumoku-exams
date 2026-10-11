"use client";

import { useEffect, useState } from "react";

/** 短い待ちでは出さない。この時間を過ぎても終わらないときだけ出す */
export const BADGE_DELAY_MS = 500;
/** 出たあと、この時間で自動で消す(終わらない遷移で、出たままにならないように) */
export const BADGE_VISIBLE_MS = 6_000;

type Props = {
  /** 待ちが続いているか */
  active: boolean;
  delayMs?: number;
  visibleMs?: number;
};

/**
 * 待ちが少し長引いたときだけ、画面の上部の中央に出す「読み込み中…」のバッジ。
 * 読み上げの領域(role="status")は常に置いておき、中身を出し入れして、スクリーンリーダーに伝える。
 */
export function LoadingBadge({ active, delayMs = BADGE_DELAY_MS, visibleMs = BADGE_VISIBLE_MS }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const show = setTimeout(() => setVisible(true), delayMs);
    const hide = setTimeout(() => setVisible(false), delayMs + visibleMs);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [active, delayMs, visibleMs]);

  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4">
      {visible ? (
        <span className="loading-badge glass text-fg">
          <span aria-hidden="true" className="spinner size-6" />
          読み込み中…
        </span>
      ) : null}
    </div>
  );
}
