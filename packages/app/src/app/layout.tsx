import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { ExamContactLink } from "@/components/exam-contact-link.tsx";
import { NavigationProgress } from "@/components/navigation-progress.tsx";
import { PageFooter, PageMain } from "@/components/page-main.tsx";
import { SessionProvider } from "@/components/session-provider.tsx";
import { SiteNav } from "@/components/site-nav.tsx";
import { guardDeps } from "@/lib/auth/deps.ts";
import { prefsForRequest } from "@/lib/prefs-server.ts";
import { THEME_COLORS } from "@/lib/pwa.ts";
import { shareMetadataOf, siteUrl } from "@/lib/site.ts";
import { THEME_INIT_SCRIPT } from "@/lib/theme.ts";
import { STYLE_INIT_SCRIPT } from "@/lib/visual-style.ts";
import "./globals.css";

const SITE_NAME = "もくもく問題集";
const DESCRIPTION = "クラウド資格の学習用に、問題を解き、間違いを復習できます。";

// 共有のカードの画像の絶対 URL は、実行の環境(Lambda の環境変数)の SITE_URL から作るので、ビルドのときではなく、要求ごとに作る
export function generateMetadata(): Metadata {
  return {
    title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
    description: DESCRIPTION,
    // ホーム画面に追加したときのアイコンと表示(マニフェストは app/manifest.ts)
    icons: { icon: { url: "/icons/icon-192.png", type: "image/png" }, apple: "/icons/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
    // 共有したとき(X・Qiita などのリンクのカード)の表示。画像は、ログインなしで取れるアイコン
    ...shareMetadataOf(siteUrl(), { title: SITE_NAME, description: DESCRIPTION, siteName: SITE_NAME }),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

/**
 * アカウントの表示の設定を、サーバーが最初の描画から反映する(読み込み後のちらつきをなくす)。
 * 設定の Cookie の持ち主が、検証した ID トークンの利用者と一致するときだけ反映する(別のアカウントの設定は使わない)。
 * 反映しないとき(未ログイン・Cookie がない・持ち主が違う)は、端末の設定を、初回描画の前のスクリプトが反映する。
 */
async function serverPrefs() {
  try {
    return await prefsForRequest((await headers()).get("cookie"), guardDeps());
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const prefs = await serverPrefs();
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      {...(prefs
        ? {
            "data-prefs": "1",
            "data-style": prefs.style,
            // 「端末に従う」は、属性を付けない(CSS の prefers-color-scheme に任せる)
            ...(prefs.theme === "system" ? {} : { "data-theme": prefs.theme }),
          }
        : {})}
    >
      <head>
        <script>{THEME_INIT_SCRIPT}</script>
        <script>{STYLE_INIT_SCRIPT}</script>
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-bold focus:text-on-primary"
        >
          本文へ移動
        </a>
        <SessionProvider>
          <NavigationProgress />
          {/* 幅が広い画面では、左にサイドバー、右に本文を並べる。狭い画面では、上のバー、本文、下のドックの順 */}
          <div className="lg:flex lg:items-start lg:gap-4 lg:p-4">
            <SiteNav />
            <div className="min-w-0 flex-1">
              <PageMain>{children}</PageMain>
              <PageFooter>
                <p>
                  学習用の問題集です。
                  <Link href="/privacy" className="ml-3 underline">
                    利用規約とプライバシーポリシー
                  </Link>
                  <Link href="/contact" className="ml-3 underline">
                    お問い合わせ
                  </Link>
                  <ExamContactLink className="ml-3 underline" />
                </p>
              </PageFooter>
            </div>
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
