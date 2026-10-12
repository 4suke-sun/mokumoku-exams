// 画面の骨組み(docs/app/design-tone.md の「骨組み」)。PC は左のサイドバー、スマホは上のバーと下のドックに、同じ項目を並べる。
// 項目は、画面ができているものだけを置く(画面ができた版で足す)。

export type NavIcon =
  | "review"
  | "home"
  | "exams"
  | "bookmark"
  | "help"
  | "release"
  | "account"
  | "admin"
  | "login"
  | "menu"
  | "back";

/** `short` は、下のドックで使う短い名前(狭い幅で 1 行に収める。読み上げには `label` を使う) */
export type NavItem = { label: string; href: string; icon: NavIcon; short?: string };

/** 学習の主要な項目(サイドバーの上の段) */
export const MAIN_NAV_ITEMS: NavItem[] = [
  { label: "ホーム", href: "/", icon: "home" },
  { label: "資格", href: "/exams", icon: "exams" },
  { label: "復習", href: "/review", icon: "review" },
  { label: "ブックマーク", href: "/bookmarks", icon: "bookmark", short: "ブクマ" },
];

/** 案内の項目(サイドバーの下の段) */
export const SUB_NAV_ITEMS: NavItem[] = [
  { label: "リリースノート", href: "/release-notes", icon: "release" },
  { label: "使い方", href: "/help", icon: "help" },
];

/** 全員に出す項目 */
export const NAV_ITEMS: NavItem[] = [...MAIN_NAV_ITEMS, ...SUB_NAV_ITEMS];

/** 管理者にだけ出す項目(使い方のページからは、リンクしない) */
export const ADMIN_NAV_ITEM: NavItem = { label: "管理", href: "/admin", icon: "admin" };

/** ナビゲーションに並べる項目。管理者の項目は、管理者にだけ足す(表示だけで、開けるかどうかはサーバーが決める)。 */
export function navItems(isAdmin: boolean): NavItem[] {
  return isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
}

/** スマホの下のドックに並べる項目。最後に「メニュー」(ほかの項目のシート)を足して、5 等分にする(狭い幅でも 1 行に収まるよう、短い名前を使う) */
export const DOCK_ITEMS: NavItem[] = MAIN_NAV_ITEMS;

/** ドックに置かず、メニューのシートに並べる項目 */
export const SHEET_ITEMS: NavItem[] = SUB_NAV_ITEMS;

/** ホームは完全一致、ほかは配下のページでも現在地とみなす。 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 出題中か。出題中は、ドックを隠して、問題に集中できるようにする */
export function isPlaying(pathname: string): boolean {
  return /^\/exams\/[^/]+\/play$/.test(pathname);
}

/** 資格の中の画面か。スマホの上のバーに「資格の一覧へ」を出す */
export function isInExam(pathname: string): boolean {
  return /^\/exams\/[^/]+(\/|$)/.test(pathname);
}

/** 画面の幅の段階。読む(文章のページ)、学ぶ(出題・結果・単元)、広い(一覧・状況) */
export type PageWidth = "read" | "study" | "wide";

/** 段階ごとの最大の幅(Tailwind が見つけられるように、クラス名は省略せずに書く) */
export const PAGE_WIDTH_CLASSES: Record<PageWidth, string> = {
  read: "max-w-2xl",
  study: "max-w-3xl",
  wide: "max-w-5xl",
};

const READ_PATHS = ["/help", "/release-notes", "/account", "/login", "/forgot-password", "/admin"];

export function pageWidth(pathname: string): PageWidth {
  if (READ_PATHS.some((href) => isActive(pathname, href))) return "read";
  if (pathname === "/" || pathname === "/exams") return "wide";
  if (/^\/exams\/[^/]+(\/dashboard)?$/.test(pathname)) return "wide";
  return "study";
}
