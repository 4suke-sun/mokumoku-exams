import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/guard.ts";
import { robotsOf, sitemapOf, siteUrl } from "./site.ts";

describe("siteUrl", () => {
  it("https のホストだけの形_その値を使う", () => {
    expect(siteUrl({ SITE_URL: "https://example.com" })).toBe("https://example.com");
    expect(siteUrl({ SITE_URL: "https://example.com:8443" })).toBe("https://example.com:8443");
  });

  it.each([undefined, "", "http://example.com", "https://example.com/", "https://example.com/path", "example.com"])(
    "形が違う_使わない_%s",
    (value) => {
      expect(siteUrl({ SITE_URL: value })).toBeNull();
    },
  );
});

describe("sitemap", () => {
  it("ログインなしで開ける画面だけを載せる", () => {
    const entries = sitemapOf("https://example.com");
    expect(entries.map((e) => e.url).sort()).toEqual([
      "https://example.com/forgot-password",
      "https://example.com/login",
      "https://example.com/privacy",
      "https://example.com/signup",
    ]);
    for (const entry of entries) expect(isPublicPath(new URL(entry.url).pathname), entry.url).toBe(true);
  });

  it("ログインが必要な画面_載せない", () => {
    const paths = sitemapOf("https://example.com").map((e) => new URL(e.url).pathname);
    for (const path of ["/", "/exams", "/account", "/help", "/release-notes", "/bookmarks"]) {
      expect(paths).not.toContain(path);
    }
  });

  it("公開の URL が設定されていない_空にする", () => {
    expect(sitemapOf(null)).toEqual([]);
  });
});

describe("robots", () => {
  it("ログインなしで開ける画面だけをクロールの対象にし_ほかは対象外にする", () => {
    const robots = robotsOf("https://example.com");
    expect(robots.rules).toEqual({
      userAgent: "*",
      allow: ["/login", "/forgot-password", "/signup", "/privacy"],
      disallow: "/",
    });
    expect(robots.sitemap).toBe("https://example.com/sitemap.xml");
  });

  it("公開の URL が設定されていない_sitemap の案内を書かない", () => {
    expect(robotsOf(null).sitemap).toBeUndefined();
  });
});
