"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { postJson } from "@/lib/auth/client.ts";
import { SEND_LIMIT_NOTE } from "@/lib/auth/messages.ts";
import { navigateWithReload } from "@/lib/auth/navigate.ts";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/auth/password.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";
import { Notice } from "./notice.tsx";

const secondaryButton = "w-full rounded-md border border-line px-5 py-3 font-bold disabled:opacity-50";

/**
 * 確認コードの入力(登録の画面と、確認がまだの利用者のログインで使う)。確認が通ると、そのままログインした状態で `next` へ移る。
 * `password` は、確認のあとにログインするために使う(登録やログインで入れたもの)。
 */
export function ConfirmCodeForm({ email, password, next = "/" }: { email: string; password: string; next?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResent(false);
    const result = await postJson("/api/auth/confirm-sign-up", { email, code, password });
    if (!result.ok) {
      setBusy(false);
      return setError(result.message);
    }
    if (result.data.status === "signed-in") {
      // ページごと読み込み直し、ログインの状態を最初から読み直す。読み込みが終わるまで、送信のボタンは押せないままにする
      navigateWithReload(next);
      return;
    }
    // 確認は通ったが、ログインはできなかったとき
    setBusy(false);
    setConfirmed(true);
  }

  async function resend() {
    setBusy(true);
    setError(null);
    setResent(false);
    const result = await postJson("/api/auth/resend-code", { email });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setResent(true);
  }

  if (confirmed) {
    return (
      <section className="space-y-4">
        <h1 className="h1">メールアドレスを確認しました</h1>
        <p className="text-muted">登録したメールアドレスとパスワードで、ログインしてください。</p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          ログインへ
        </Link>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <h1 className="h1">確認コードの入力</h1>
      <p className="text-muted break-all">{email} に届いた確認コードを入力してください。</p>
      <Field
        id="signup-code"
        label="確認コード"
        value={code}
        onChange={setCode}
        autoComplete="one-time-code"
        inputMode="numeric"
      />
      <FormError message={error} />
      {resent ? <Notice kind="success">確認コードを送り直しました。</Notice> : null}
      <SubmitButton busy={busy}>確認する</SubmitButton>
      <button type="button" className={secondaryButton} disabled={busy} onClick={() => void resend()}>
        コードを送り直す
      </button>
      <p className="text-sm">
        <Link href="/login" className="text-primary underline">
          ログインへ戻る
        </Link>
      </p>
    </form>
  );
}

/** 新規登録: メールアドレスとパスワードを登録し、同じ画面のまま、確認コードの入力に切り替える。 */
export function SignupForm() {
  const [step, setStep] = useState<"register" | "confirm">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("確認用のパスワードが一致しません。");
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/sign-up", { email, password });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setStep("confirm");
  }

  if (step === "confirm") return <ConfirmCodeForm email={email.trim()} password={password} />;

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <h1 className="h1">新規登録</h1>
      <Notice kind="info">{SEND_LIMIT_NOTE}</Notice>
      <Field id="email" label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="username" />
      <Field
        id="password"
        label="パスワード"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={PASSWORD_RULE_TEXT}
      />
      <Field
        id="confirm-password"
        label="パスワード(確認)"
        type="password"
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
      />
      <p className="text-sm">
        登録すると、
        <Link href="/privacy" className="text-primary underline">
          利用規約とプライバシーポリシー
        </Link>
        に同意したものとします。
      </p>
      <FormError message={error} />
      <SubmitButton busy={busy}>登録する</SubmitButton>
      <p className="text-sm">
        <Link href="/login" className="text-primary underline">
          ログインへ戻る
        </Link>
      </p>
    </form>
  );
}
