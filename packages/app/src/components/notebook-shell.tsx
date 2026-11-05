"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef, useState } from "react";
import { NotebookProgressProvider, useNotebookProgress } from "@/components/notebook-progress.tsx";
import type { TocDomain } from "@/lib/notebook-data.ts";
import { currentOf, isEntryDone, unitProgress } from "@/lib/notebook-review.ts";

type Props = {
  examCode: string;
  /** 管理者のプレビュー(履修済みを読まず、記録もしない) */
  preview: boolean;
  /** 表紙の URL。節のページは `<basePath>/<中分類の ID>/<見出しの ID>` */
  basePath: string;
  toc: TocDomain[];
  children: ReactNode;
};

/**
 * 3 段の目次(分野 → 中分類 → 節)。節に完了の印、中分類に完了した節の数と履修済みの印を付ける(アカウントから読めたときだけ)。
 * いまの中分類だけ節を開き、中分類の行で開閉する。見出しのない中分類は、補助の色で薄く出し、開けない。
 * いまの中分類が変わったら、開閉の操作を捨てる(いまの中分類を開く)。
 */
export function NotebookToc({ basePath, toc }: { basePath: string; toc: TocDomain[] }) {
  const pathname = usePathname();
  const current = currentOf(pathname, basePath);
  return <TocBody key={current.unit ?? ""} basePath={basePath} toc={toc} current={current} pathname={pathname} />;
}

function TocBody({
  basePath,
  toc,
  current,
  pathname,
}: {
  basePath: string;
  toc: TocDomain[];
  current: { unit?: string; entry?: string };
  pathname: string;
}) {
  const { records } = useNotebookProgress();
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const panelPrefix = useId();
  const itemClass = (active: boolean) =>
    `flex items-baseline justify-between gap-2 rounded-md px-2 py-1 ${
      active ? "bg-soft font-bold text-primary" : "text-fg hover:bg-bg"
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
                if (unit.count === 0) {
                  // 見出しのない中分類: 薄く出し、開けない。印も付けない
                  return (
                    <li key={unit.id}>
                      <p className="flex items-baseline justify-between gap-2 px-2 py-1 pl-4 text-muted">
                        <span>
                          {unit.number} {unit.title}
                        </span>
                        <span className="shrink-0 text-xs">
                          0<span className="sr-only"> 件</span>
                        </span>
                      </p>
                    </li>
                  );
                }
                const open = toggled.get(unit.id) ?? unit.id === current.unit;
                const panelId = `${panelPrefix}-${unit.id}`;
                const progress = records ? unitProgress(unit, records) : null;
                return (
                  <li key={unit.id}>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => setToggled((m) => new Map(m).set(unit.id, !open))}
                      className={`${itemClass(false)} w-full pl-4 text-left ${unit.id === current.unit ? "font-bold" : ""}`}
                    >
                      <span>
                        <span aria-hidden="true">{open ? "▾" : "▸"} </span>
                        {unit.number} {unit.title}
                        {progress?.completed ? (
                          <span className="text-correct">
                            {" "}
                            <span aria-hidden="true">✓</span>
                            <span className="sr-only">履修済み</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-xs">
                        {progress ? `${progress.done} / ${progress.total}` : unit.count}
                        <span className="sr-only">{progress ? " 節完了" : " 件"}</span>
                      </span>
                    </button>
                    {open ? (
                      <ol id={panelId} className="space-y-0.5 pt-0.5">
                        {unit.entries.map((entry) => {
                          const active = unit.id === current.unit && entry.id === current.entry;
                          const done = records ? isEntryDone(records, unit.id, entry.id) : false;
                          return (
                            <li key={entry.id}>
                              <Link
                                href={`${basePath}/${unit.id}/${entry.id}`}
                                aria-current={active ? "page" : undefined}
                                className={`${itemClass(active)} pl-8`}
                              >
                                <span>{entry.term}</span>
                                {done ? (
                                  <span className="shrink-0 text-correct">
                                    <span aria-hidden="true">✓</span>
                                    <span className="sr-only">完了</span>
                                  </span>
                                ) : null}
                              </Link>
                            </li>
                          );
                        })}
                      </ol>
                    ) : null}
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
 * 目次の中で、いまの節の項目(`aria-current="page"`)が見えていなければ、目次だけをスクロールして、項目を見える範囲の中ほどに出す。
 * ページ(window)はスクロールしない(`scrollIntoView` は、ページごと動かすため使わない)。
 */
export function revealCurrent(container: HTMLElement) {
  const item = container.querySelector<HTMLElement>('[aria-current="page"]');
  if (!item) return;
  const box = container.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  if (rect.top >= box.top && rect.bottom <= box.bottom) return;
  container.scrollTop += rect.top - box.top - (box.height - rect.height) / 2;
}

/**
 * 体系ノートの枠。広い画面(`md` 以上)は、目次を左に固定し、狭い画面は ☰ の「目次」で、左から出す。
 * 目次は、ページのどこまで読み進めても開ける(追従する)。広い画面の目次は、スクロールしても画面に残り、
 * サイトの上のバー(`lg` 未満で上に固定)と重ならない。狭い画面の「☰ 目次」は、上のバーのすぐ下に固定する。
 */
export function NotebookShell({ examCode, preview, basePath, toc, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const drawerId = useId();
  const close = useCallback(() => setOpen(false), []);
  const side = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 遷移したら目次を閉じる
  useEffect(() => {
    setOpen(false);
    if (side.current) revealCurrent(side.current);
  }, [pathname]);

  return (
    <NotebookProgressProvider examCode={examCode} preview={preview}>
      <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-8">
        <aside className="hidden md:block">
          {/* `lg` 未満は、サイトの上のバー(上に固定。高さ約 3rem)の下に固定する */}
          <div
            ref={side}
            className="sticky top-16 max-h-[calc(100dvh-5rem)] overflow-y-auto pb-4 lg:top-4 lg:max-h-[calc(100dvh-2rem)]"
          >
            <NotebookToc basePath={basePath} toc={toc} />
          </div>
        </aside>
        <div className="min-w-0">
          {/* 上のバー(高さ約 3rem)の下に、少し間を空けて固定する(`top-14`)。ボタンの外側は、下の本文を押せるよう、押す対象にしない */}
          <div data-testid="notebook-toc-bar" className="pointer-events-none sticky top-14 z-20 mb-4 md:hidden">
            <button
              ref={button}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? drawerId : undefined}
              onClick={() => setOpen(true)}
              className="pointer-events-auto inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-bold shadow-sm"
            >
              <span aria-hidden="true">☰</span>目次
            </button>
          </div>
          {children}
        </div>
        {open ? <TocDrawer id={drawerId} basePath={basePath} toc={toc} onClose={close} returnFocus={button} /> : null}
      </div>
    </NotebookProgressProvider>
  );
}
