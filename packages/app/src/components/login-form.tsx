"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { postJson } from "@/lib/auth/client.ts";
import { navigateWithReload } from "@/lib/auth/navigate.ts";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/auth/password.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";
import { Notice } from "./notice.tsx";
import { ConfirmCodeForm } from "./signup-form.tsx";

type Step =
  | { name: "login" }
  // 招待された人の初回ログイン。新しいパスワードを決める(招待済みで未使用の利用者のために残す)
  | { name: "new-password"; session: string; username: string }
  // 登録したが、確認コードの入力がまだの利用者
  | { name: "confirm" };

/**
 * `next`: ログインしたあとに移る場所(サーバー側で検査済みの、このサイト内の画面)。
 * `deleted`: 退会のあとに移ってきたとき、「退会しました」と出す。
 */
export function LoginForm({ next = "/", deleted = false }: { next?: string; deleted?: boolean }) {
  const [step, setStep] = useState<Step>({ name: "login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function done() {
    // ページごと読み込み直し、ログインの状態を最初から読み直す。読み込みが終わるまで、送信のボタンは押せないままにする
    setBusy(true);
    navigateWithReload(next);
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/login", { email, password });
    setBusy(false);
    // 確認がまだのときは、確認コードの入力へ移す(入れたパスワードは、確認のあとのログインに使う)
    if (!result.ok && result.code === "not-confirmed") return setStep({ name: "confirm" });
    if (!result.ok) return setError(result.message);
    if (result.data.status === "new-password-required") {
      setPassword("");
      setStep({
        name: "new-password",
        session: String(result.data.session),
        username: String(result.data.username),
      });
      return;
    }
    done();
  }

  async function submitNewPassword(event: FormEvent) {
    event.preventDefault();
    if (step.name !== "new-password") return;
    const problem = passwordProblem(newPassword);
    if (problem) return setError(problem);
    if (newPassword !== confirm) return setError("確認用のパスワードが一致しません。");
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/new-password", {
      username: step.username,
      session: step.session,
      newPassword,
    });
    setBusy(false);
    if (!result.ok) {
      // 手続きの期限切れは、最初のログインからやり直す
      if (result.status === 401) setStep({ name: "login" });
      return setError(result.message);
    }
    done();
  }

  if (step.name === "confirm") return <ConfirmCodeForm email={email.trim()} password={password} next={next} />;

  if (step.name === "new-password") {
    return (
      <form onSubmit={submitNewPassword} className="space-y-5" noValidate>
        <h1 className="h1">パスワードを決める</h1>
        <p className="text-muted">はじめてのログインです。これから使うパスワードを決めてください。</p>
        <Field
          id="new-password"
          label="新しいパスワード"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
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
        <SubmitButton busy={busy}>パスワードを決めてログインする</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={submitLogin} className="space-y-5">
      <h1 className="h1">ログイン</h1>
      {deleted ? <Notice kind="success">退会しました。</Notice> : null}
      <p className="text-muted">メールアドレスとパスワードで、ログインしてください。</p>
      <Field id="email" label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="username" />
      <Field
        id="password"
        label="パスワード"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      <FormError message={error} />
      <SubmitButton busy={busy}>ログインする</SubmitButton>
      <p className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <Link href="/signup" className="text-primary underline">
          新規登録
        </Link>
        <Link href="/forgot-password" className="text-primary underline">
          パスワードを忘れたとき
        </Link>
      </p>
    </form>
  );
}
