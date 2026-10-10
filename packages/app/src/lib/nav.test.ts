import { describe, expect, it } from "vitest";
import { isActive, NAV_ITEMS } from "./nav.ts";

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
