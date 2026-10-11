import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEM, DOCK_ITEMS, isActive, isInExam, isPlaying, NAV_ITEMS, navItems, pageWidth } from "./nav.ts";

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
  it("使い方とリリースノートのページ_並んでいる", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/help")).toMatchObject({ label: "使い方" });
    expect(NAV_ITEMS.find((item) => item.href === "/release-notes")).toMatchObject({ label: "リリースノート" });
  });

  it("まだない画面_置かない", () => {
    expect(NAV_ITEMS.some((item) => item.href === "/history")).toBe(false);
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
    expect(ADMIN_NAV_ITEM).toMatchObject({ label: "管理", href: "/admin" });
  });

  it("共通の項目_管理者の経路を含まない(使い方のページからリンクできない)", () => {
    expect(NAV_ITEMS.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });
});

describe("DOCK_ITEMS", () => {
  it("メニューと合わせて 5 つまで_管理を含まない", () => {
    expect(DOCK_ITEMS.length + 1).toBeLessThanOrEqual(5);
    expect(DOCK_ITEMS.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });
});

describe("isPlaying と isInExam", () => {
  it("出題の画面だけが_出題中", () => {
    expect(isPlaying("/exams/SAMPLE/play")).toBe(true);
    expect(isPlaying("/exams/SAMPLE/result")).toBe(false);
    expect(isPlaying("/exams")).toBe(false);
  });

  it("資格の中の画面_資格の一覧は含まない", () => {
    expect(isInExam("/exams/SAMPLE")).toBe(true);
    expect(isInExam("/exams/SAMPLE/study/basics")).toBe(true);
    expect(isInExam("/exams")).toBe(false);
    expect(isInExam("/")).toBe(false);
  });
});

describe("pageWidth", () => {
  it.each([
    ["/help", "read"],
    ["/release-notes", "read"],
    ["/admin", "read"],
    ["/login", "read"],
    ["/", "wide"],
    ["/exams", "wide"],
    ["/exams/SAMPLE", "wide"],
    ["/exams/SAMPLE/dashboard", "wide"],
    ["/exams/SAMPLE/play", "study"],
    ["/exams/SAMPLE/result", "study"],
    ["/exams/SAMPLE/study/basics", "study"],
    ["/bookmarks", "study"],
  ])("%s_%s", (path, width) => {
    expect(pageWidth(path)).toBe(width);
  });
});
