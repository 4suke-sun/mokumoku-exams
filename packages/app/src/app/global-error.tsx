"use client";

import "./globals.css";

// 共通レイアウトそのものが失敗したときの画面。レイアウトの部品は使えないので、最小限で作る
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-bg p-8 text-fg">
        <h1 className="h1">問題が起きました</h1>
        <p className="my-4 text-muted">画面を表示できませんでした。もう一度試してください。</p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          もう一度試す
        </button>
      </body>
    </html>
  );
}
