"use client";

import Link from "next/link";
import { useSession } from "./session-provider.tsx";

/** ヘッダーのログイン状態。ログイン中はアカウント画面とログアウト、そうでなければログインへの案内。 */
export function AuthStatus() {
  const { state, signOut } = useSession();
  if (state.status === "loading") return <span className="text-sm text-muted">&nbsp;</span>;
  if (state.status === "signed-out") {
    return (
      <Link href="/login" className="text-sm text-fg hover:underline">
        ログイン
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <Link href="/account" className="text-fg hover:underline">
        アカウント
      </Link>
      <button type="button" onClick={() => void signOut()} className="rounded-md border border-line px-3 py-1">
        ログアウト
      </button>
    </div>
  );
}
