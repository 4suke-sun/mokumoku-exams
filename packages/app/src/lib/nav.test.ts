import { describe, expect, it } from "vitest";
import {
  ADMIN_NAV_ITEM,
  DOCK_ITEMS,
  examCodeOf,
  isActive,
  isInExam,
  isPlaying,
  NAV_ITEMS,
  navItems,
  pageWidth,
} from "./nav.ts";

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

  it("実績の画面_ホームの次の段に置く", () => {
    expect(NAV_ITEMS.find((item) => item.href === "/achievements")).toMatchObject({ label: "実績" });
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
  it("メニューと合わせて 6 つまで_管理を含まない", () => {
    expect(DOCK_ITEMS.length + 1).toBeLessThanOrEqual(6);
    expect(DOCK_ITEMS.some((item) => item.href.startsWith("/admin"))).toBe(false);
  });
});

describe("examCodeOf", () => {
  it("資格の中の画面_その資格コードを返す", () => {
    expect(examCodeOf("/exams/EX-SMP-XX")).toBe("EX-SMP-XX");
    expect(examCodeOf("/exams/EX-SMP-XX/")).toBe("EX-SMP-XX");
    expect(examCodeOf("/exams/EX-SMP-XX/notebook/basics/entry")).toBe("EX-SMP-XX");
  });

  it("資格の外の画面_null を返す", () => {
    expect(examCodeOf("/exams")).toBeNull();
    expect(examCodeOf("/exams/")).toBeNull();
    expect(examCodeOf("/")).toBeNull();
    expect(examCodeOf("/contact")).toBeNull();
  });

  it("符号化された区切り_元に戻し_戻せないときは null を返す", () => {
    expect(examCodeOf("/exams/A%26B")).toBe("A&B");
    expect(examCodeOf("/exams/%E0%A4%A")).toBeNull();
  });
});

describe("isPlaying と isInExam", () => {
  it("出題の画面だけが_出題中", () => {
    expect(isPlaying("/exams/EX-SMP-XX/play")).toBe(true);
    expect(isPlaying("/exams/EX-SMP-XX/result")).toBe(false);
    expect(isPlaying("/exams")).toBe(false);
  });

  it("資格の中の画面_資格の一覧は含まない", () => {
    expect(isInExam("/exams/EX-SMP-XX")).toBe(true);
    expect(isInExam("/exams/EX-SMP-XX/study/basics")).toBe(true);
    expect(isInExam("/exams")).toBe(false);
    expect(isInExam("/")).toBe(false);
  });
});

describe("pageWidth", () => {
  it.each([
    ["/help", "read"],
    ["/release-notes", "read"],
    ["/admin", "read"],
    ["/admin/preview", "study"],
    ["/admin/preview/AIB", "study"],
    ["/login", "read"],
    ["/signup", "read"],
    ["/privacy", "read"],
    ["/", "wide"],
    ["/exams", "wide"],
    ["/exams/EX-SMP-XX", "wide"],
    ["/exams/EX-SMP-XX/dashboard", "wide"],
    ["/exams/EX-SMP-XX/play", "play"],
    ["/exams/EX-SMP-XX/result", "wide"],
    ["/achievements", "wide"],
    ["/exams/EX-SMP-XX/cards", "wide"],
    ["/exams/EX-SMP-XX/info", "wide"],
    ["/exams/EX-SMP-XX/study/basics", "study"],
    ["/bookmarks", "study"],
    ["/exams/DBX-DEA-2605/notebook", "wide"],
    ["/exams/DBX-DEA-2605/notebook/domain7-1", "wide"],
    ["/admin/preview/DBX-DEA-2605/notebook/domain7-1", "wide"],
  ])("%s_%s", (path, width) => {
    expect(pageWidth(path)).toBe(width);
  });
});
