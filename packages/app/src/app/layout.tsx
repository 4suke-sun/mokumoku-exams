import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { NavigationProgress } from "@/components/navigation-progress.tsx";
import { PageFooter, PageMain } from "@/components/page-main.tsx";
import { SessionProvider } from "@/components/session-provider.tsx";
import { SiteNav } from "@/components/site-nav.tsx";
import { THEME_COLORS } from "@/lib/pwa.ts";
import { THEME_INIT_SCRIPT } from "@/lib/theme.ts";
import { STYLE_INIT_SCRIPT } from "@/lib/visual-style.ts";
import "./globals.css";

const SITE_NAME = "もくもく問題集";
const DESCRIPTION = "クラウド資格の学習用に、問題を解き、間違いを復習できます。";

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: DESCRIPTION,
  // ホーム画面に追加したときのアイコンと表示(マニフェストは app/manifest.ts)
  icons: { icon: { url: "/icons/icon-192.png", type: "image/png" }, apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "default" },
  // 共有したときの表示は最小限にする(ログインが必要なので、URL と画像は持たない)
  openGraph: { title: SITE_NAME, description: DESCRIPTION, siteName: SITE_NAME, locale: "ja_JP", type: "website" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
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
                <p>学習用の問題集です。</p>
              </PageFooter>
            </div>
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
