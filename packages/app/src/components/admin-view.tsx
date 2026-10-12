"use client";

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { createdLabel, disableUser, fetchUsers, inviteUser, promoteUser, statusLabel } from "@/lib/admin/client.ts";
import type { AdminUserRow } from "@/lib/admin/handlers.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";
import { Notice } from "./notice.tsx";

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; users: AdminUserRow[] };

const secondaryButton = "rounded-md border border-line px-3 py-1 disabled:opacity-50";

/**
 * 管理者にする前の、確認のダイアログ。背景の操作を止め(`aria-modal`)、開いたら、安全側の「やめる」にフォーカスを置く。
 * Tab はダイアログの中で巡回し、Esc で閉じる。閉じたら、開いたボタンへフォーカスを戻す(呼び出し側)。
 */
function PromoteDialog({
  user,
  busy,
  onConfirm,
  onCancel,
}: {
  user: AdminUserRow;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    // 2 つのボタンの間で、フォーカスを巡回させる
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    // 背景のタップで閉じるのは、押し間違いを避けるため、行わない
    <div role="presentation" className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="promote-title"
        aria-describedby="promote-description"
        onKeyDown={onKeyDown}
        className="card w-full max-w-md space-y-4 p-5"
      >
        <h2 id="promote-title" className="h2">
          管理者にしますか
        </h2>
        <p id="promote-description" className="text-sm">
          <span className="break-all font-bold">{user.email ?? "このユーザー"}</span>{" "}
          を管理者にします。管理者は、ユーザーの招待と無効化、管理者の追加、全問のプレビューができます。
          この画面からは、管理者を元に戻せません。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button ref={cancelRef} type="button" className={secondaryButton} disabled={busy} onClick={onCancel}>
            やめる
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded-md bg-primary px-3 py-1 font-bold text-on-primary disabled:opacity-50"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "処理しています…" : "管理者にする"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 管理者の画面: 招待のフォームと、利用者の一覧(無効化は、確認のステップのあとに行う)。 */
export function AdminView() {
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // 無効にする前の確認の対象(ユーザー名)
  const [confirming, setConfirming] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disableMessage, setDisableMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // 管理者にする前の確認の対象と、開いたボタン(閉じたときにフォーカスを戻す)
  const [promoting, setPromoting] = useState<AdminUserRow | null>(null);
  const [promoteBusy, setPromoteBusy] = useState(false);
  const promoteTrigger = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    const result = await fetchUsers();
    setList(result.ok ? { status: "ready", users: result.data.users } : { status: "error", message: result.message });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteError(null);
    setInvited(null);
    const result = await inviteUser(email);
    setInviting(false);
    if (!result.ok) return setInviteError(result.message);
    setInvited(result.data.user.email ?? email.trim());
    setEmail("");
    await load();
  }

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

  function closePromote() {
    setPromoting(null);
    // 開いたボタンへフォーカスを戻す(一覧が読み直されても、行のボタンは同じ位置に残る)
    queueMicrotask(() => promoteTrigger.current?.focus());
  }

  async function confirmPromote(user: AdminUserRow) {
    setPromoteBusy(true);
    const result = await promoteUser(user.username);
    setPromoteBusy(false);
    setPromoting(null);
    setDisableMessage(
      result.ok
        ? { ok: true, text: `${user.email ?? "ユーザー"} を管理者にしました。` }
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

      <form onSubmit={submitInvite} className="max-w-md space-y-5" noValidate>
        <h2 className="h2">ユーザーを招待する</h2>
        <Field
          id="invite-email"
          label="メールアドレス"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="off"
          hint="招待メール(仮のパスワードつき)が送られます。サイトの URL は、別に伝えてください。"
        />
        <FormError message={inviteError} />
        {invited ? (
          <Notice kind="success">
            {invited} を招待しました。仮のパスワードでログインすると、新しいパスワードを決める画面に進みます。
          </Notice>
        ) : null}
        <SubmitButton busy={inviting}>招待する</SubmitButton>
      </form>

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
                    <button
                      type="button"
                      className={`${secondaryButton} mr-2`}
                      aria-label={`${user.email ?? "このユーザー"}を管理者にする`}
                      onClick={(event) => {
                        promoteTrigger.current = event.currentTarget;
                        setDisableMessage(null);
                        setPromoting(user);
                      }}
                    >
                      管理者にする…
                    </button>
                  ) : null}
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
      {promoting ? (
        <PromoteDialog
          user={promoting}
          busy={promoteBusy}
          onConfirm={() => void confirmPromote(promoting)}
          onCancel={closePromote}
        />
      ) : null}
    </section>
  );
}
