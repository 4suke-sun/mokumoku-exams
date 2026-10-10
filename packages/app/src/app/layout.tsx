import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavigationProgress } from "@/components/navigation-progress.tsx";
import { SiteHeader } from "@/components/site-header.tsx";
import { THEME_INIT_SCRIPT } from "@/lib/theme.ts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "もくもく問題集", template: "%s | もくもく問題集" },
  description: "クラウド資格の学習用に、問題を解き、間違いを復習できます。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script>{THEME_INIT_SCRIPT}</script>
      </head>
      <body className="min-h-screen bg-bg text-fg antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-bold focus:text-on-primary"
        >
          本文へ移動
        </a>
        <NavigationProgress />
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8">
          {children}
        </main>
        <footer className="mx-auto max-w-3xl px-4 pb-8 text-sm text-muted">
          <p>学習用の問題集です。</p>
        </footer>
      </body>
    </html>
  );
}
