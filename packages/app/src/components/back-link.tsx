"use client";

import { useRouter } from "next/navigation";

/** 元の画面へ戻る(ブラウザの履歴を 1 つ戻る) */
export function BackLink() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="text-primary underline hover:opacity-80">
      元の画面へ戻る
    </button>
  );
}
