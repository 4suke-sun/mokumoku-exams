import type { ReactNode } from "react";

/** 教科書のパートの種類ごとの、色の左の線(Tailwind が見つけられるよう、クラス名は省略せずに書く) */
const BORDER: Record<StudyTone, string> = {
  primary: "border-l-primary",
  violet: "border-l-violet",
  orange: "border-l-orange",
  correct: "border-l-correct",
  muted: "border-l-muted",
};

export type StudyTone = "primary" | "violet" | "orange" | "correct" | "muted";

/**
 * 教科書の 1 パート(「この単元で学ぶこと」「本文」「図」「要点」「ここがポイント」「出典」)を囲むカード。
 * 色の左の線でパートを見分け、見出しの文字でも伝える(色だけに頼らない)。アイコンは飾り。
 * `id` は、節の ID(英小文字・数字・ハイフン)と重ならないよう、下線を含む形にする。
 */
export function StudyCard({
  id,
  tone,
  icon,
  title,
  titleClassName = "text-xl font-bold",
  children,
}: {
  id: string;
  tone: StudyTone;
  icon?: string;
  title: string;
  titleClassName?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={`card space-y-3 border-l-4 p-4 ${BORDER[tone]}`}>
      <h2 id={`${id}-title`} className={titleClassName}>
        {icon ? (
          <span aria-hidden="true" className="mr-2">
            {icon}
          </span>
        ) : null}
        {title}
      </h2>
      {children}
    </section>
  );
}
