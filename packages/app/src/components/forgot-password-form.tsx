"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { postJson } from "@/lib/auth/client.ts";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/auth/password.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";

type Step = "request" | "reset" | "done";

export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/forgot-password", { email });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setStep("reset");
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(newPassword);
    if (problem) return setError(problem);
    if (newPassword !== confirm) return setError("確認用のパスワードが一致しません。");
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/reset-password", { email, code, newPassword });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setStep("done");
  }

  if (step === "done") {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">パスワードを変更しました</h1>
        <p className="text-muted">新しいパスワードで、ログインしてください。</p>
        <Link
          href="/login"
          className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          ログインへ
        </Link>
      </section>
    );
  }

  if (step === "reset") {
    return (
      <form onSubmit={submitReset} className="space-y-5" noValidate>
        <h1 className="text-2xl font-bold">新しいパスワードを決める</h1>
        <p className="text-muted">
          登録されているメールアドレスなら、確認コードを送りました。届いたコードと、新しいパスワードを入力してください。
        </p>
        <Field
          id="code"
          label="確認コード"
          value={code}
          onChange={setCode}
          autoComplete="one-time-code"
          inputMode="numeric"
        />
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
        <SubmitButton busy={busy}>パスワードを変更する</SubmitButton>
      </form>
    );
  }

  return (
    <form onSubmit={submitRequest} className="space-y-5">
      <h1 className="text-2xl font-bold">パスワードの再設定</h1>
      <p className="text-muted">登録したメールアドレスに、確認コードを送ります。</p>
      <Field id="email" label="メールアドレス" type="email" value={email} onChange={setEmail} autoComplete="username" />
      <FormError message={error} />
      <SubmitButton busy={busy}>確認コードを送る</SubmitButton>
      <p className="text-sm">
        <Link href="/login" className="text-primary underline">
          ログインに戻る
        </Link>
      </p>
    </form>
  );
}
