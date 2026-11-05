"use client";

import { useCallback, useEffect, useState } from "react";
import { createdLabel, disableUser, fetchUsers, statusLabel } from "@/lib/admin/client.ts";
import type { AdminUserRow } from "@/lib/admin/handlers.ts";
import { Notice } from "./notice.tsx";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: AdminUserRow[] };

const secondaryButton = "rounded-md border border-line px-3 py-1 disabled:opacity-50";

/** 管理者の画面: 利用者の一覧(無効化は、確認のステップのあとに行う)。利用者は、自分で登録する。 */
export function AdminView() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  // 無効にする前の確認の対象(ユーザー名)
  const [confirming, setConfirming] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disableMessage, setDisableMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const result = await fetchUsers();
    setList(result.ok ? { status: "ready", users: result.data.users } : { status: "error", message: result.message });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmDisable(user: AdminUserRow) {
    setDisabling(true);
    const result = await disableUser(user.username);
    setDisabling(false);
    setConfirming(null);
    setDisableMessage(
      result.ok
        ? { ok: true, text: `${user.email ?? "ユーザー"} を無効にしました。` }
        : { ok: false, text: result.message },
    );
    await load();
  }

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="h1">管理</h1>
        <p className="text-sm text-muted">この画面は、管理者のグループに入っているアカウントだけが開けます。</p>
      </div>

      <div className="space-y-3">
        <h2 className="h2">ユーザーの一覧</h2>
        {disableMessage ? <Notice kind={disableMessage.ok ? "success" : "error"}>{disableMessage.text}</Notice> : null}
        {list.status === "loading" ? <p className="text-muted">読み込んでいます…</p> : null}
        {list.status === "error" ? (
          <div className="space-y-2">
            <Notice kind="error">{list.message}</Notice>
            <button type="button" className={secondaryButton} onClick={() => void load()}>
              読み直す
            </button>
          </div>
        ) : null}
        {list.status === "ready" ? (
          list.users.length === 0 ? (
            <p className="text-muted">ユーザーはいません。</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {list.users.map((user) => (
                <li key={user.username} className="space-y-2 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="break-all font-bold">
                      {user.email ?? "(メールアドレスなし)"}
                      {user.self ? <span className="ml-2 text-sm font-normal text-muted">(自分)</span> : null}
                    </span>
                    <span className="text-sm text-muted">
                      {statusLabel(user)} ・ 作成日 {createdLabel(user.createdAt)}
                    </span>
                  </div>
                  {user.enabled && !user.self ? (
                    confirming === user.username ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">
                          無効にすると、このユーザーはログインできなくなります。無効にしますか?
                        </span>
                        <button
                          type="button"
                          className="rounded-md border border-incorrect px-3 py-1 font-bold text-incorrect disabled:opacity-50"
                          disabled={disabling}
                          onClick={() => void confirmDisable(user)}
                        >
                          {disabling ? "処理しています…" : "無効にする"}
                        </button>
                        <button
                          type="button"
                          className={secondaryButton}
                          disabled={disabling}
                          onClick={() => setConfirming(null)}
                        >
                          やめる
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => {
                          setDisableMessage(null);
                          setConfirming(user.username);
                        }}
                      >
                        無効にする…
                      </button>
                    )
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
