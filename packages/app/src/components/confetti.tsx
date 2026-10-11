"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { CONFETTI_COUNT, CONFETTI_PERFECT_COUNT, CONFETTI_TOTAL_MS, confettiPieces } from "@/lib/confetti.ts";
import { usePrefersReducedMotion, useVisualStyle } from "@/lib/use-visual-style.ts";
import { shouldShowConfetti } from "@/lib/visual-style.ts";

// 色は役割の色と分野の色から選ぶ(テーマに合わせて変わる)
const COLORS = [
  "var(--primary)",
  "var(--correct)",
  "var(--warn)",
  "var(--domain-1)",
  "var(--domain-2)",
  "var(--domain-4)",
];

type Props = {
  /** 合格ラインに届いたか。届いたときだけ出す */
  reached: boolean;
  /** 満点か。満点のときは、量を増やす */
  perfect?: boolean;
};

/**
 * 合格ラインに届いた結果で、1 度だけ降らせる紙吹雪。飾りなので、読み上げの対象にせず、操作も妨げない。
 * リッチのときだけ出す。端末の「動きを減らす」設定が有効なときは、スタイルにかかわらず出さない。
 * 落ちる動きは CSS(globals.css の .confetti-piece)が持ち、ここでは出すかどうかと、片の配置だけを決める。
 */
export function Confetti({ reached, perfect = false }: Props) {
  const show = shouldShowConfetti(useVisualStyle(), usePrefersReducedMotion(), reached);
  const [pieces] = useState(() =>
    confettiPieces(perfect ? CONFETTI_PERFECT_COUNT : CONFETTI_COUNT, COLORS.length, Math.random),
  );
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setDone(true), CONFETTI_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show || done) return null;

  return (
    <div aria-hidden="true" data-confetti="" className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {pieces.map((piece, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 片の並びは描画のあいだ変わらない
          key={i}
          className="confetti-piece"
          style={
            {
              left: `${piece.left}%`,
              background: COLORS[piece.color],
              animationDelay: `${piece.delayMs}ms`,
              animationDuration: `${piece.durationMs}ms`,
              "--confetti-rotate": `${piece.rotate}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
