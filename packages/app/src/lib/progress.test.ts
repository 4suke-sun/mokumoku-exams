import { describe, expect, it } from "vitest";
import { startsNavigation } from "./progress.ts";

const current = new URL("https://example.com/exams");
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const link = (href: string, target = "") => ({ href, target, hasAttribute: () => false });

describe("startsNavigation", () => {
  it("同じサイトの別ページ_遷移が始まる", () => {
    expect(startsNavigation(link("https://example.com/exams/saa"), plain, current)).toBe(true);
  });

  it("同じページ_始まらない", () => {
    expect(startsNavigation(link("https://example.com/exams"), plain, current)).toBe(false);
  });

  it("外部サイト_始まらない", () => {
    expect(startsNavigation(link("https://example.org/"), plain, current)).toBe(false);
  });

  it("別タブで開く_始まらない", () => {
    expect(startsNavigation(link("https://example.com/", "_blank"), plain, current)).toBe(false);
  });

  it("修飾キー付き_始まらない", () => {
    expect(startsNavigation(link("https://example.com/"), { ...plain, metaKey: true }, current)).toBe(false);
  });
});
