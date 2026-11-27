"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Notice } from "./notice.tsx";
import { useSession } from "./session-provider.tsx";

/** ログインの画面の URL。ログインのあとに `next` へ戻す(`next` は、ログインの画面が `safeNext` で確かめる) */
export function loginHref(next: string): string {
  return `/login?${new URLSearchParams({ next }).toString()}`;
}

/**
 * ログインなしで開ける画面の中で、ログインが要る部分(送信のフォームなど)を出し分ける部品。
 * ログイン中は `children` を出し、ログインしていなければ、代わりに「ログインが必要です」とログインへのリンクを出す。
 * ログイン状態を確かめている間は、どちらも出さない(出し分けが入れ替わってちらつかないように)。
 * 表示の出し分けだけで、認可はサーバーが行う(ログインが要る API は、入口の proxy が断る)。
 *
 * - `action`: ログインが要る操作の名前(例: 「お問い合わせを送る」)。「〜には、ログインが必要です。」の形で出す。
 * - `next`: ログインのあとに戻る、このサイト内の画面(今の画面)。
 */
export function LoginRequired({ action, next, children }: { action: string; next: string; children: ReactNode }) {
  const { state } = useSession();
  if (state.status === "loading") return null;
  if (state.status === "signed-in") return <>{children}</>;
  return (
    <div className="space-y-3">
      <Notice kind="info">{action}には、ログインが必要です。</Notice>
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={loginHref(next)} className="font-bold text-primary underline">
          ログインする
        </Link>
        <Link href="/signup" className="text-primary underline">
          新規登録
        </Link>
      </p>
    </div>
  );
}
