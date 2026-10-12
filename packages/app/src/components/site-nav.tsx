"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import {
  ADMIN_NAV_ITEM,
  DOCK_ITEMS,
  isActive,
  isInExam,
  isPlaying,
  MAIN_NAV_ITEMS,
  type NavItem,
  SHEET_ITEMS,
  SUB_NAV_ITEMS,
} from "@/lib/nav.ts";
import { NavIcon } from "./nav-icon.tsx";
import { UnreadDot, useUnreadRelease } from "./release-seen.tsx";
import { useSession } from "./session-provider.tsx";
import { StyleToggle } from "./style-toggle.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

/**
 * 画面の骨組み。幅が広い画面では左のサイドバー、狭い画面では上のバーと下のドックを出す(出し分けは CSS の lg)。
 * 項目は、どちらも同じ(lib/nav.ts)。
 */
export function SiteNav() {
  return (
    <>
      <TopBar />
      <Sidebar />
      <Dock />
    </>
  );
}

/** ロゴ。マスコットは飾りなので、代替テキストを空にし、名前は文字で出す */
function Brand({ size = "size-9" }: { size?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md font-bold text-fg">
      {/* biome-ignore lint/performance/noImgElement: 小さな固定の画像なので、最適化の経路を通さずに出す */}
      <img src="/brand/mascot.png" alt="" width={256} height={256} className={size} />
      <span className="whitespace-nowrap">もくもく問題集</span>
    </Link>
  );
}

function useAdmin(): boolean {
  const { state } = useSession();
  return state.status === "signed-in" && state.isAdmin === true;
}

/** 項目の名前。リリースノートには、未読の目印を添える */
function ItemLabel({ item, unread }: { item: NavItem; unread: boolean }) {
  return (
    <>
      <NavIcon name={item.icon} />
      <span className="whitespace-nowrap">{item.label}</span>
      {unread && item.href === "/release-notes" ? <UnreadDot /> : null}
    </>
  );
}

/** ログイン中は、アカウントとログアウト。そうでなければ、ログインへの案内 */
function AccountLinks({ pathname, itemClass }: { pathname: string; itemClass: (active: boolean) => string }) {
  const { state } = useSession();
  if (state.status === "loading") return null;
  const item: NavItem =
    state.status === "signed-in"
      ? { label: "アカウント", href: "/account", icon: "account" }
      : { label: "ログイン", href: "/login", icon: "login" };
  const active = isActive(pathname, item.href);
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
      <NavIcon name={item.icon} />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>
  );
}

function SignOutButton() {
  const { state, signOut } = useSession();
  if (state.status !== "signed-in") return null;
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="w-full rounded-md border border-line px-3 py-2 text-sm font-bold hover:border-primary"
    >
      ログアウト
    </button>
  );
}

const sideItemClass = (active: boolean) =>
  `relative z-10 flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
    active ? "font-bold text-primary" : "text-fg hover:bg-bg"
  }`;

/** 幅が広い画面の、左のカード状のサイドバー。選択中の背景が、項目の間を滑って動く */
function Sidebar() {
  const pathname = usePathname();
  const isAdmin = useAdmin();
  const unread = useUnreadRelease();
  const listRef = useRef<HTMLUListElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
  const { state } = useSession();

  // 選択中の項目の位置に、背景を動かす(ログイン状態で項目が増減しても、位置を取り直す)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 現在地とログイン状態が変わったら、位置を取り直す
  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    setIndicator(current ? { top: current.offsetTop, height: current.offsetHeight } : null);
  }, [pathname, isAdmin, state.status]);

  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    return (
      <li key={item.href}>
        <Link href={item.href} aria-current={active ? "page" : undefined} className={sideItemClass(active)}>
          <ItemLabel item={item} unread={unread} />
        </Link>
      </li>
    );
  };

  return (
    <aside className="sticky top-4 hidden h-[calc(100dvh-2rem)] w-60 shrink-0 lg:block">
      <div className="card flex h-full flex-col gap-5 overflow-y-auto p-3">
        <div className="px-2 pt-1">
          <Brand />
        </div>
        <nav aria-label="主要メニュー">
          <ul ref={listRef} className="relative space-y-1">
            {indicator ? (
              <li
                aria-hidden="true"
                className="nav-indicator absolute inset-x-0 top-0 rounded-md bg-soft"
                style={{ height: indicator.height, transform: `translateY(${indicator.top}px)` }}
              />
            ) : null}
            {MAIN_NAV_ITEMS.map(link)}
            <li aria-hidden="true" className="mx-3 my-3 border-t border-line" />
            {SUB_NAV_ITEMS.map(link)}
            <li>
              <AccountLinks pathname={pathname} itemClass={sideItemClass} />
            </li>
            {isAdmin ? link(ADMIN_NAV_ITEM) : null}
          </ul>
        </nav>
        <div className="mt-auto space-y-3 px-1 pb-1">
          <ThemeToggle />
          <StyleToggle />
          <SignOutButton />
        </div>
      </div>
    </aside>
  );
}

/** 狭い画面の、上に固定するバー。資格の中の画面では、資格の一覧へ戻るボタンを出す */
function TopBar() {
  const pathname = usePathname();
  return (
    <header className="glass sticky top-0 z-30 border-b border-line lg:hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <Brand size="size-8" />
        {isInExam(pathname) ? (
          <Link
            href="/exams"
            className="flex items-center gap-1 rounded-md border border-line bg-surface px-3 py-1 text-sm font-bold whitespace-nowrap"
          >
            <NavIcon name="back" className="size-4" />
            資格の一覧へ
          </Link>
        ) : null}
      </div>
    </header>
  );
}

const dockItemClass = (active: boolean) =>
  `flex flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-xs ${
    active ? "bg-soft font-bold text-primary" : "text-fg"
  }`;

/** 狭い画面の、下に浮くドック。最後の項目は、ほかの項目を並べたメニューのシート。出題中は隠す */
function Dock() {
  const pathname = usePathname();
  const unread = useUnreadRelease();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sheetId = useId();

  // biome-ignore lint/correctness/useExhaustiveDependencies: 遷移したらシートを閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (isPlaying(pathname)) return null;

  return (
    <>
      <nav aria-label="主要メニュー" className="glass card fixed inset-x-3 bottom-3 z-30 lg:hidden">
        <ul className="grid grid-cols-5 gap-0.5 p-1">
          {DOCK_ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.short ? item.label : undefined}
                  className={dockItemClass(active)}
                >
                  <NavIcon name={item.icon} />
                  <span className="whitespace-nowrap">{item.short ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              ref={menuButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? sheetId : undefined}
              onClick={() => setOpen(true)}
              className={`relative w-full ${dockItemClass(false)}`}
            >
              <NavIcon name="menu" />
              <span className="whitespace-nowrap">メニュー</span>
              {unread ? <UnreadDot /> : null}
            </button>
          </li>
        </ul>
      </nav>
      {open ? <MenuSheet id={sheetId} onClose={() => setOpen(false)} returnFocus={menuButton} /> : null}
    </>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * メニューのシート。Esc、背景のタップ、「閉じる」で閉じる。開いている間は、Tab の移動をシートの中に留め、
 * 閉じたら、開いたボタンにフォーカスを戻す。
 */
export function MenuSheet({
  id,
  onClose,
  returnFocus,
}: {
  id: string;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const pathname = usePathname();
  const isAdmin = useAdmin();
  const unread = useUnreadRelease();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const back = returnFocus?.current;
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

  const items = isAdmin ? [...SHEET_ITEMS, ADMIN_NAV_ITEM] : SHEET_ITEMS;
  const sheetItemClass = (active: boolean) =>
    `flex items-center gap-3 rounded-md px-3 py-2 ${active ? "bg-soft font-bold text-primary" : "text-fg hover:bg-bg"}`;

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label="メニューを閉じる"
        onClick={onClose}
        className="absolute inset-0 size-full bg-black/40"
      />
      <div
        ref={panel}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet-panel card absolute inset-x-3 bottom-3 max-h-[80dvh] space-y-4 overflow-y-auto p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id={titleId} className="h2">
            メニュー
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
        <ul className="space-y-1">
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link href={item.href} aria-current={active ? "page" : undefined} className={sheetItemClass(active)}>
                  <ItemLabel item={item} unread={unread} />
                </Link>
              </li>
            );
          })}
          <li>
            <AccountLinks pathname={pathname} itemClass={sheetItemClass} />
          </li>
        </ul>
        <div className="space-y-3 border-t border-line pt-4">
          <ThemeToggle />
          <StyleToggle />
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
