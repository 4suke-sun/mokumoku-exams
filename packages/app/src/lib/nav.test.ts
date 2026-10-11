import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEM, isActive, NAV_ITEMS, navItems } from "./nav.ts";

describe("isActive", () => {
  it("ホームで/_ホームが現在地", () => {
    expect(isActive("/", "/")).toBe(true);
  });

  it("資格の配下_ホームは現在地でない", () => {
    expect(isActive("/exams/saa", "/")).toBe(false);
  });

  it("資格の配下_資格が現在地", () => {
    expect(isActive("/exams/saa/play", "/exams")).toBe(true);
  });

  it("前方一致するだけの別パス_現在地でない", () => {
    expect(isActive("/examsx", "/exams")).toBe(false);
  });
});

describe("NAV_ITEMS", () => {
  it("使い方のページ_押せる状態で並んでいる", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/help")).toMatchObject({ label: "使い方", ready: true });
  });

  it("リンク先が重複しない", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});

describe("navItems", () => {
  it("管理者でない_管理の項目を出さない", () => {
    expect(navItems(false)).toEqual(NAV_ITEMS);
    expect(navItems(false).some((item) => item.href.startsWith("/admin"))).toBe(false);
  });

  it("管理者_管理の項目を最後に足す", () => {
    expect(navItems(true)).toEqual([...NAV_ITEMS, ADMIN_NAV_ITEM]);
    expect(ADMIN_NAV_ITEM).toEqual({ label: "管理", href: "/admin", ready: true });
  });

  it("共通の項目_管理者の経路を含まない(使い方のページからリンクできない)", () => {
    expect(NAV_ITEMS.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });
});
