"use client";

import Link from "next/link";

// 内部のエラーメッセージは画面に出さない(docs/app/lessons/0002)
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">問題が起きました</h1>
      <p className="text-muted">表示中にエラーが起きました。もう一度試すか、トップへ戻ってください。</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          もう一度試す
        </button>
        <Link href="/" className="rounded-md border border-line px-5 py-3 font-bold hover:border-primary">
          トップへ戻る
        </Link>
      </div>
    </section>
  );
}
