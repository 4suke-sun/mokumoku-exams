import { describe, expect, it } from "vitest";
import { extractLinks, extractUpdatedDate, hasDeprecationSignal } from "./html.ts";
import { fixture } from "./test-helpers.ts";

describe("HTML の手がかり", () => {
  it("リンク_絶対の URL にし、フラグメントと data のリンクを落とす", () => {
    const links = extractLinks(fixture("guide.html"), "https://docs.aws.amazon.com/guide/index.html");
    expect(links).toContain("https://docs.aws.amazon.com/guide/detail/one.html");
    expect(links).toContain("https://docs.aws.amazon.com/guide/detail/two.html");
    expect(links.some((l) => l.startsWith("data:"))).toBe(false);
    expect(links.some((l) => l.includes("#"))).toBe(false);
  });

  it("更新日_meta、time 要素、Last-Modified の順に探し、なければ null", () => {
    expect(extractUpdatedDate(fixture("guide.html"), null)).toBe("2026-06-01");
    expect(extractUpdatedDate(fixture("stale.html"), null)).toBe("2020-01-15");
    expect(extractUpdatedDate('<time datetime="2026-05-02">x</time>', null)).toBe("2026-05-02");
    expect(extractUpdatedDate(fixture("doc.html"), "Tue, 02 Jun 2026 00:00:00 GMT")).toBe("2026-06-02");
    expect(extractUpdatedDate(fixture("doc.html"), null)).toBeNull();
  });

  it("廃止の兆候_ページ全体の言い回しだけに反応する", () => {
    expect(hasDeprecationSignal(fixture("deprecated.html"))).toBe(true);
    expect(hasDeprecationSignal(fixture("doc.html"))).toBe(false);
    expect(hasDeprecationSignal("<p>この試験は提供を終了しました。</p>")).toBe(true);
  });
});
