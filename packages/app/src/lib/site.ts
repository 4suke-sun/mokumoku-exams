import type { Metadata, MetadataRoute } from "next";
import { PUBLIC_PAGE_PATHS } from "@/lib/auth/guard.ts";

// robots と sitemap の中身。sitemap の URL は絶対 URL が要るが、配信のドメインは環境ごとに違うため、
// リポジトリに書かず、実行の環境の `SITE_URL`(例: `https://example.com`)から読む。

const SITE_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

/** 公開の URL の起点。`https://<ホスト>` の形でなければ null(sitemap は空になる)。 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.SITE_URL;
  return value && SITE_URL_PATTERN.test(value) ? value : null;
}

/** 共有のカードの画像。ログインなしで取れる公開のファイル(CloudFront が S3 から配る)のアイコン。正方形 */
export const SHARE_IMAGE = { path: "/icons/icon-512.png", width: 512, height: 512 } as const;

/**
 * 共有したとき(X・Qiita などのリンクのカード)の表示。画像は絶対 URL が要るので、公開の URL の起点(`SITE_URL`)があるときだけ付ける。
 * 起点がない環境(手元の開発など)では、画像を付けない(相対の URL は、カードを作る側が読めないため出さない)。
 * 画像が正方形なので、X のカードは、小さな正方形の画像の `summary` にする。
 */
export function shareMetadataOf(
  origin: string | null,
  text: { title: string; description: string; siteName: string },
): Pick<Metadata, "metadataBase" | "openGraph" | "twitter"> {
  const image = origin
    ? { url: `${origin}${SHARE_IMAGE.path}`, width: SHARE_IMAGE.width, height: SHARE_IMAGE.height }
    : null;
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    openGraph: {
      title: text.title,
      description: text.description,
      siteName: text.siteName,
      locale: "ja_JP",
      type: "website",
      ...(image ? { images: [{ ...image, alt: text.siteName }] } : {}),
    },
    twitter: {
      card: "summary",
      title: text.title,
      description: text.description,
      ...(image ? { images: [image.url] } : {}),
    },
  };
}

/** このサービスのリポジトリ */
export const REPOSITORY_URL = "https://github.com/4suke-sun/mokumoku-exams";

/** リポジトリの Issue の一覧。送信フォームで送った内容の起票先として、利用規約とプライバシーポリシーの画面に出す。 */
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

/** 版(`vX.Y.Z`)の GitHub の Release のページ。開発の項目だけの版の、リリースノートの画面から案内する。 */
export function releaseUrl(version: string): string {
  return `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(version)}`;
}

/**
 * 検索エンジンに案内するのは、ログインなしで開ける画面だけ。ほかはすべて対象外にする。
 * 共有のカードの画像も許す(X などのカードの取得は robots.txt に従うため、許さないと画像が出ない)。
 */
export function robotsOf(origin: string | null): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: [...PUBLIC_PAGE_PATHS, SHARE_IMAGE.path], disallow: "/" },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}

/** sitemap に載せるのは、ログインなしで開ける画面だけ。 */
export function sitemapOf(origin: string | null): MetadataRoute.Sitemap {
  if (!origin) return [];
  return [...PUBLIC_PAGE_PATHS].map((path) => ({ url: `${origin}${path}` }));
}
