import type { MetadataRoute } from "next";
import { PUBLIC_PAGE_PATHS } from "@/lib/auth/guard.ts";

// robots と sitemap の中身。sitemap の URL は絶対 URL が要るが、配信のドメインは環境ごとに違うため、
// リポジトリに書かず、実行の環境の `SITE_URL`(例: `https://example.com`)から読む。

const SITE_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** 公開の URL の起点。`https://<ホスト>` の形でなければ null(sitemap は空になる)。 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.SITE_URL;
  return value && SITE_URL_PATTERN.test(value) ? value : null;
}

/** このサービスのリポジトリ */
export const REPOSITORY_URL = "https://github.com/4suke-sun/mokumoku-exams";

/** 問い合わせ先(リポジトリの Issue の一覧)。プライバシーと利用条件の画面に出す。 */
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

/** 検索エンジンに案内するのは、ログインなしで開ける画面だけ。ほかはすべて対象外にする。 */
export function robotsOf(origin: string | null): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: [...PUBLIC_PAGE_PATHS], disallow: "/" },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}

/** sitemap に載せるのは、ログインなしで開ける画面だけ。 */
export function sitemapOf(origin: string | null): MetadataRoute.Sitemap {
  if (!origin) return [];
  return [...PUBLIC_PAGE_PATHS].map((path) => ({ url: `${origin}${path}` }));
}
