"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import type { TocDomain } from "@/lib/notebook-data.ts";

type Props = {
  /** 表紙の URL。中分類のページは `<basePath>/<中分類の ID>` */
  basePath: string;
  toc: TocDomain[];
  children: ReactNode;
};

/** 2 段の目次(分野 → 中分類)。中分類ごとに見出しの数を出し、空の中分類は補助の色で薄く出す */
export function NotebookToc({ basePath, toc }: { basePath: string; toc: TocDomain[] }) {
  const pathname = usePathname();
  const itemClass = (active: boolean, empty = false) =>
    `flex items-baseline justify-between gap-2 rounded-md px-2 py-1 ${
      active ? "bg-soft font-bold text-primary" : empty ? "text-muted hover:bg-bg" : "text-fg hover:bg-bg"
    }`;
  return (
    <nav aria-label="体系ノートの目次" className="space-y-3 text-sm">
      <Link
        href={basePath}
        aria-current={pathname === basePath ? "page" : undefined}
        className={itemClass(pathname === basePath)}
      >
        表紙
      </Link>
      <ol className="space-y-3">
        {toc.map((domain) => (
          <li key={domain.code} className="space-y-1">
            <p className="flex items-baseline justify-between gap-2 px-2 font-bold">
              <span>
                {domain.number}. {domain.name}
              </span>
              <span className="text-xs text-muted">
                {domain.count}
                <span className="sr-only"> 件</span>
              </span>
            </p>
            <ol className="space-y-0.5">
              {domain.units.map((unit) => {
                const href = `${basePath}/${unit.id}`;
                const active = pathname === href;
                return (
                  <li key={unit.id}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`${itemClass(active, unit.count === 0)} pl-4`}
                    >
                      <span>
                        {unit.number} {unit.title}
                      </span>
                      <span className="shrink-0 text-xs">
                        {unit.count}
                        <span className="sr-only"> 件</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </nav>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 狭い画面の目次。左から出す。開くと先頭から表示し、項目を選ぶか、外側を押すか、Esc か、「閉じる」で閉じる。
 * 開いている間は、Tab の移動を目次の中に留め、閉じたら、開いたボタンにフォーカスを戻す(メニューのシートと同じ)。
 */
function TocDrawer({
  id,
  basePath,
  toc,
  onClose,
  returnFocus,
}: {
  id: string;
  basePath: string;
  toc: TocDomain[];
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
    closeButton.current?.focus();
    const back = returnFocus.current;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      back?.focus();
    };
  }, [onClose, returnFocus]);

  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="目次を閉じる"
        onClick={onClose}
        className="absolute inset-0 size-full bg-black/40"
      />
      {/* 項目(リンク)を選んだら閉じる。移った先の画面は、目次の外に出る */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: キーでの選択も、リンクの click として届く */}
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a")) onClose();
        }}
        className="drawer-panel absolute inset-y-0 left-0 w-[min(84vw,20rem)] space-y-4 overflow-y-auto border-r border-line bg-surface p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="h2">
            目次
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1 text-sm font-bold"
          >
            閉じる
          </button>
        </div>
        <NotebookToc basePath={basePath} toc={toc} />
      </div>
    </div>
  );
}

/**
 * 体系ノートの枠。広い画面(`md` 以上)は、目次を左に固定し、狭い画面は ☰ の「目次」で、左から出す。
 */
export function NotebookShell({ basePath, toc, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const close = useCallback(() => setOpen(false), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 遷移したら目次を閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
      <aside className="hidden md:block">
        <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pb-4">
          <NotebookToc basePath={basePath} toc={toc} />
        </div>
      </aside>
      <div className="min-w-0">
        <div className="mb-4 md:hidden">
          <button
            ref={button}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? drawerId : undefined}
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-bold"
          >
            <span aria-hidden="true">☰</span>目次
          </button>
        </div>
        {children}
      </div>
      {open ? <TocDrawer id={drawerId} basePath={basePath} toc={toc} onClose={close} returnFocus={button} /> : null}
    </div>
  );
}
