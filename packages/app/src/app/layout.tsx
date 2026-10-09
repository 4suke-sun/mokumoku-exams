import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "もくもく問題集", template: "%s | もくもく問題集" },
  description: "クラウド資格の学習用に、問題を解き、間違いを復習できます。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-bg text-fg antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-3xl items-center px-4 py-3">
            <Link href="/" className="text-lg font-bold text-fg hover:underline">
              もくもく問題集
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-3xl px-4 pb-8 text-sm text-muted">
          <p>学習用の問題集です。</p>
        </footer>
      </body>
    </html>
  );
}
