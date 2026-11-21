import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/guard.ts";
import { robotsOf, SHARE_IMAGE, shareMetadataOf, sitemapOf, siteUrl } from "./site.ts";

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
  it("ログインなしで開ける画面と共有のカードの画像だけをクロールの対象にし_ほかは対象外にする", () => {
    const robots = robotsOf("https://example.com");
    expect(robots.rules).toEqual({
      userAgent: "*",
      allow: ["/login", "/forgot-password", "/signup", "/privacy", "/icons/icon-512.png"],
      disallow: "/",
    });
    expect(robots.sitemap).toBe("https://example.com/sitemap.xml");
  });

  it("公開の URL が設定されていない_sitemap の案内を書かない", () => {
    expect(robotsOf(null).sitemap).toBeUndefined();
  });
});

describe("shareMetadataOf", () => {
  const text = { title: "題", description: "説明", siteName: "サイト" };

  it("公開の URL がある_カードの画像にアイコンの絶対 URL を付け_X のカードは summary にする", () => {
    const meta = shareMetadataOf("https://example.com", text);
    expect(meta.metadataBase?.toString()).toBe("https://example.com/");
    expect(meta.openGraph).toMatchObject({
      title: "題",
      siteName: "サイト",
      images: [{ url: "https://example.com/icons/icon-512.png", width: 512, height: 512 }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary", images: ["https://example.com/icons/icon-512.png"] });
  });

  it("公開の URL がない_画像を付けず_相対の URL も出さない", () => {
    const meta = shareMetadataOf(null, text);
    expect(meta.metadataBase).toBeUndefined();
    expect(meta.openGraph).not.toHaveProperty("images");
    expect(meta.twitter).not.toHaveProperty("images");
    expect(meta.twitter).toMatchObject({ card: "summary" });
  });

  it("カードの画像_ログインなしで取れる公開のファイルである", () => {
    expect(isPublicPath(SHARE_IMAGE.path)).toBe(true);
  });
});
