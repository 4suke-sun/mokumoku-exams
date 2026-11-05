"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { Notice } from "@/components/notice.tsx";
import { postJson } from "@/lib/auth/client.ts";
import { navigateWithReload } from "@/lib/auth/navigate.ts";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/auth/password.ts";
import { changePrefs } from "@/lib/prefs-client.ts";
import { browserStore, DEFAULT_SETTINGS, loadSettings, removeOwnerRecords, storageOwner } from "@/lib/storage.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";
import { PushSettings } from "./push-settings.tsx";
import { useSession } from "./session-provider.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

/** `pushPublicKey` は、通知の購読に使う VAPID の公開鍵。設定されていなければ null。 */
export function AccountView({ pushPublicKey = null }: { pushPublicKey?: string | null }) {
  const { state, reload } = useSession();
  const [previous, setPrevious] = useState("");
  const [proposed, setProposed] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shuffleChoices, setShuffleChoices] = useState(DEFAULT_SETTINGS.shuffleChoices);

  useEffect(() => {
    setShuffleChoices(loadSettings(browserStore()).shuffleChoices);
  }, []);

  if (state.status === "loading") return <p className="text-muted">読み込んでいます…</p>;
  if (state.status === "signed-out") {
    return (
      <section className="space-y-4">
        <h1 className="h1">アカウント</h1>
        <p className="text-muted">アカウントを見るには、ログインしてください。</p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          ログインへ
        </Link>
      </section>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setChanged(false);
    const problem = passwordProblem(proposed);
    if (problem) return setError(problem);
    if (proposed !== confirm) return setError("確認用のパスワードが一致しません。");
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/change-password", {
      previousPassword: previous,
      proposedPassword: proposed,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      // ログインの期限が切れていたときは、状態を読み直してログイン画面へ戻す
      if (result.code === "session-expired") await reload();
      return;
    }
    setPrevious("");
    setProposed("");
    setConfirm("");
    setChanged(true);
  }

  function changeShuffle(next: boolean) {
    setShuffleChoices(next);
    void changePrefs({ shuffleChoices: next });
  }

  return (
    <section className="space-y-8">
      <h1 className="h1">アカウント</h1>

      <div className="space-y-1">
        <h2 className="h2">ログイン中のメールアドレス</h2>
        <p>{state.email ?? "(取得できませんでした)"}</p>
      </div>

      <form onSubmit={submit} className="max-w-md space-y-5" noValidate>
        <h2 className="h2">パスワードの変更</h2>
        <Field
          id="previous-password"
          label="いまのパスワード"
          type="password"
          value={previous}
          onChange={setPrevious}
          autoComplete="current-password"
        />
        <Field
          id="proposed-password"
          label="新しいパスワード"
          type="password"
          value={proposed}
          onChange={setProposed}
          autoComplete="new-password"
          hint={PASSWORD_RULE_TEXT}
        />
        <Field
          id="confirm-password"
          label="新しいパスワード(確認)"
          type="password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <FormError message={error} />
        {changed ? (
          <Notice kind="success">パスワードを変更しました。次のログインから、新しいパスワードを使ってください。</Notice>
        ) : null}
        <SubmitButton busy={busy}>パスワードを変更する</SubmitButton>
      </form>

      <div className="space-y-3">
        <h2 className="h2">表示と出題の設定</h2>
        <p className="text-sm text-muted">
          この端末と、アカウントに保存されます(ほかの端末でログインしても、同じ設定になります)。
          モード選択で選ぶ解答の表示のしかたは、この端末にだけ保存されます。
        </p>
        <div className="flex items-center gap-3">
          <span>表示テーマ</span>
          <ThemeToggle />
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-5"
            checked={shuffleChoices}
            onChange={(event) => changeShuffle(event.target.checked)}
          />
          選択肢の並びをシャッフルする
        </label>
      </div>

      <PushSettings publicKey={pushPublicKey} canSendTest={state.isAdmin} />

      <DeleteAccount onSessionExpired={reload} />
    </section>
  );
}

const secondaryButton = "rounded-md border border-line px-5 py-3 font-bold disabled:opacity-50";

/**
 * 退会の節。「退会する…」で、消えるものと元に戻せないことを示し、パスワードを求める(管理者の画面の無効化と同じ 2 段の確認)。
 * 退会が通ったら、この端末の学習の記録(持ち主の印で分けたもの)を消し、ログインの画面へ移る。
 */
function DeleteAccount({ onSessionExpired }: { onSessionExpired: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const owner = storageOwner();
    const result = await postJson("/api/auth/delete-account", { password });
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      // ログインの期限が切れていたときは、状態を読み直してログイン画面へ戻す
      if (result.code === "session-expired") await onSessionExpired();
      return;
    }
    try {
      if (owner) removeOwnerRecords(window.localStorage, owner);
    } catch {
      // 保存が禁止されているときなど。消せなくても、持ち主の違う記録は読まれない
    }
    // ページごと読み込み直し、ログアウトした状態から読み直す。読み込みが終わるまで、ボタンは押せないままにする
    navigateWithReload("/login?deleted=1");
  }

  return (
    <div className="max-w-md space-y-3">
      <h2 className="h2">退会</h2>
      {confirming ? (
        <form onSubmit={submit} className="space-y-5" noValidate>
          <p>退会すると、次のものを消します。元に戻すことはできません。</p>
          <ul className="list-disc space-y-1 pl-6">
            <li>アカウント</li>
            <li>サーバーの学習の記録</li>
            <li>通知の購読</li>
            <li>この端末の学習の記録</li>
          </ul>
          <Field
            id="delete-password"
            label="パスワード"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <FormError message={error} />
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-incorrect px-5 py-3 font-bold text-incorrect disabled:opacity-50"
            >
              {busy ? "処理しています…" : "退会する"}
            </button>
            <button
              type="button"
              className={secondaryButton}
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setPassword("");
                setError(null);
              }}
            >
              やめる
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={secondaryButton} onClick={() => setConfirming(true)}>
          退会する…
        </button>
      )}
    </div>
  );
}
