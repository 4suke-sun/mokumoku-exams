"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Notice } from "./notice.tsx";
import { useSession } from "./session-provider.tsx";

/** ログインの画面の URL。ログインのあとに `next` へ戻す(`next` は、ログインの画面が `safeNext` で確かめる) */
export function loginHref(next: string): string {
  return `/login?${new URLSearchParams({ next }).toString()}`;
}

/** ボタンの見た目のリンク。主はログイン、副はアカウントの作成 */
const PRIMARY_BUTTON =
  "inline-flex items-center justify-center rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90";
const SECONDARY_BUTTON =
  "inline-flex items-center justify-center rounded-md border border-line bg-surface px-5 py-3 font-bold text-fg hover:border-primary";

/**
 * ログインなしで開ける画面の中で、ログインが要る部分(送信のフォームなど)を出し分ける部品。
 * ログイン中は `children` を出し、ログインしていなければ、代わりに `message` と、
 * 「ログインする」(ログインのあとに `next` へ戻る)・「アカウントを作成する」(新規登録の画面へ)のボタンを出す。
 * ログイン状態を確かめている間は、どちらも出さない(出し分けが入れ替わってちらつかないように)。
 * 表示の出し分けだけで、認可はサーバーが行う(ログインが要る API は、入口の proxy が断る)。
 *
 * - `message`: ログインしていないときに出す案内(例: 「投稿はログインユーザーのみ受け付けております。」)。
 * - `next`: ログインのあとに戻る、このサイト内の画面(今の画面)。
 */
export function LoginRequired({ message, next, children }: { message: string; next: string; children: ReactNode }) {
  const { state } = useSession();
  if (state.status === "loading") return null;
  if (state.status === "signed-in") return <>{children}</>;
  return (
    <div className="space-y-4">
      <Notice kind="info">{message}</Notice>
      <div className="flex flex-wrap gap-3">
        <Link href={loginHref(next)} className={PRIMARY_BUTTON}>
          ログインする
        </Link>
        <Link href="/signup" className={SECONDARY_BUTTON}>
          アカウントを作成する
        </Link>
      </div>
    </div>
  );
}
