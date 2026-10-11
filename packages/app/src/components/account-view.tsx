"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { postJson } from "@/lib/auth/client.ts";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/auth/password.ts";
import { browserStore, DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/storage.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";
import { useSession } from "./session-provider.tsx";
import { ThemeToggle } from "./theme-toggle.tsx";

export function AccountView() {
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
        <h1 className="text-2xl font-bold">アカウント</h1>
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
    saveSettings(browserStore(), { ...loadSettings(browserStore()), shuffleChoices: next });
  }

  return (
    <section className="space-y-8">
      <h1 className="text-2xl font-bold">アカウント</h1>

      <div className="space-y-1">
        <h2 className="text-lg font-bold">ログイン中のメールアドレス</h2>
        <p>{state.email ?? "(取得できませんでした)"}</p>
      </div>

      <form onSubmit={submit} className="max-w-md space-y-5" noValidate>
        <h2 className="text-lg font-bold">パスワードの変更</h2>
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
          <p role="status" className="text-correct">
            パスワードを変更しました。次のログインから、新しいパスワードを使ってください。
          </p>
        ) : null}
        <SubmitButton busy={busy}>パスワードを変更する</SubmitButton>
      </form>

      <div className="space-y-3">
        <h2 className="text-lg font-bold">表示と出題の設定</h2>
        <p className="text-sm text-muted">この端末のブラウザに保存されます。</p>
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
    </section>
  );
}
