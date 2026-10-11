import type { ReactNode } from "react";

export type NoticeKind = "error" | "success" | "info";

// 種類は、色だけでなく、記号と(読み上げ用の)種類の名前でも伝える
const KINDS: Record<NoticeKind, { mark: string; name: string; tone: string; surface: string }> = {
  error: { mark: "!", name: "エラー", tone: "bg-incorrect", surface: "border-incorrect bg-incorrect-bg" },
  success: { mark: "✓", name: "完了", tone: "bg-correct", surface: "border-correct bg-correct-bg" },
  info: { mark: "i", name: "お知らせ", tone: "bg-primary", surface: "border-primary bg-soft" },
};

type Props = {
  kind: NoticeKind;
  children: ReactNode;
  className?: string;
};

/**
 * エラー・成功・お知らせの通知。エラーはすぐに読み上げ(role="alert")、ほかは控えめに読み上げる(role="status")。
 * 文字は本文の色にして、種類は左の縁の色と記号で示す。
 */
export function Notice({ kind, children, className = "" }: Props) {
  const { mark, name, tone, surface } = KINDS[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      data-kind={kind}
      className={`flex items-start gap-3 rounded-md border border-l-4 px-3 py-2 text-fg ${surface} ${className}`}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold text-surface ${tone}`}
      >
        {mark}
      </span>
      <p className="min-w-0">
        <span className="sr-only">{name}: </span>
        {children}
      </p>
    </div>
  );
}
