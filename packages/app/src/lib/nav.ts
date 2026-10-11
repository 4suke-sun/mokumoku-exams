export type NavItem = { label: string; href: string; ready: boolean };

// ready が false の項目は、画面ができるまで「近日公開」として押せなくしておく
export const NAV_ITEMS: NavItem[] = [
  { label: "ホーム", href: "/", ready: true },
  { label: "資格", href: "/exams", ready: true },
  { label: "使い方", href: "/help", ready: true },
  { label: "履歴", href: "/history", ready: false },
  { label: "ブックマーク", href: "/bookmarks", ready: true },
  { label: "リリースノート", href: "/release-notes", ready: true },
];

/** 管理者にだけ出す項目(使い方のページからは、リンクしない) */
export const ADMIN_NAV_ITEM: NavItem = { label: "管理", href: "/admin", ready: true };

/** ナビゲーションに並べる項目。管理者の項目は、管理者にだけ足す(表示だけで、開けるかどうかはサーバーが決める)。 */
export function navItems(isAdmin: boolean): NavItem[] {
  return isAdmin ? [...NAV_ITEMS, ADMIN_NAV_ITEM] : NAV_ITEMS;
}

/** ホームは完全一致、ほかは配下のページでも現在地とみなす。 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
