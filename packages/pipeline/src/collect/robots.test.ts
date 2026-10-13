import { describe, expect, it } from "vitest";
import { isAllowed, rulesFor } from "./robots.ts";
import { fixture } from "./test-helpers.ts";

describe("robots.txt の解釈", () => {
  const star = rulesFor(fixture("robots.txt"), "other-bot/1.0");
  const own = rulesFor(fixture("robots.txt"), "mokumoku-exams-pipeline/1.0 (source collector)");

  it("* の組_Disallow と、より長い Allow", () => {
    expect(isAllowed(star, "/private/x")).toBe(false);
    expect(isAllowed(star, "/private/open/x")).toBe(true);
    expect(isAllowed(star, "/public/x")).toBe(true);
  });

  it("* と $_ワイルドカードと行末", () => {
    expect(isAllowed(star, "/docs/a.pdf")).toBe(false);
    expect(isAllowed(star, "/docs/a.pdf?x=1")).toBe(true);
  });

  it("製品名の組があれば、その組だけを使う", () => {
    expect(isAllowed(own, "/guide/private/a")).toBe(false);
    expect(isAllowed(own, "/private/x")).toBe(true);
  });

  it("規則がない・空_すべて許す。robots.txt 自体は常に許す", () => {
    expect(isAllowed(rulesFor("", "x"), "/a")).toBe(true);
    expect(isAllowed(rulesFor("User-agent: *\nDisallow: /", "x"), "/robots.txt")).toBe(true);
    expect(isAllowed(rulesFor("User-agent: *\nDisallow: /", "x"), "/a")).toBe(false);
  });
});
