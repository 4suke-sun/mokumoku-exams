"use client";

import { useEffect, useState } from "react";
import { countUpValue } from "@/lib/count-up.ts";
import { usePrefersReducedMotion, useVisualStyle } from "@/lib/use-visual-style.ts";
import { effectsEnabled } from "@/lib/visual-style.ts";

type Props = {
  /** 最終的に表示する割合(0〜100) */
  percent: number;
  /** 合格ラインに達しているか(色を決める) */
  reached: boolean;
};

const DURATION_MS = 1200;
const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * 正答率の表示。読み上げには、最終の値だけを伝える。
 * リッチ: 円のゲージと、0 から最終の値まで増える数値。
 * シンプル: 円を描かず、最終の値をそのまま表示する。
 * 動きを減らす設定の端末では、スタイルにかかわらずカウントアップしない。
 */
export function ScoreRing({ percent, reached }: Props) {
  const style = useVisualStyle();
  const animate = effectsEnabled(style, usePrefersReducedMotion());
  // この部品は、結果の読み込みが終わった後にだけ描画される(サーバーでは描画されない)。
  // 最初の描画から 0 にしておき、最終の値が一瞬見えるちらつきを避ける
  const [shown, setShown] = useState(() => (animate ? 0 : percent));

  useEffect(() => {
    if (!animate) {
      setShown(percent);
      return;
    }
    setShown(0);
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const value = countUpValue(percent, now - start, DURATION_MS);
      setShown(value);
      if (value !== percent) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [percent, animate]);

  if (style === "simple") {
    return (
      <p
        role="img"
        aria-label={`正答率 ${percent}%`}
        className={`shrink-0 text-4xl font-bold ${reached ? "text-correct" : "text-warn"}`}
      >
        <span aria-hidden="true">{percent}%</span>
      </p>
    );
  }

  const offset = CIRCUMFERENCE * (1 - shown / 100);

  return (
    <div className="relative size-36 shrink-0" role="img" aria-label={`正答率 ${percent}%`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={RADIUS} fill="none" strokeWidth="10" className="stroke-line" />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className={reached ? "stroke-correct" : "stroke-warn"}
        />
      </svg>
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-3xl font-bold">
        {shown}%
      </span>
    </div>
  );
}
