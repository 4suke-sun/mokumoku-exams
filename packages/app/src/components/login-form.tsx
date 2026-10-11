"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { postJson } from "@/lib/auth/client.ts";
import { PASSWORD_RULE_TEXT, passwordProblem } from "@/lib/auth/password.ts";
import { Field, FormError, SubmitButton } from "./form-parts.tsx";
import { useSession } from "./session-provider.tsx";

type Step =
  | { name: "login" }
  // 招待された人の初回ログイン。新しいパスワードを決める
  | { name: "new-password"; session: string; username: string };

export function LoginForm() {
  const router = useRouter();
  const { reload } = useSession();
  const [step, setStep] = useState<Step>({ name: "login" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function done() {
    await reload();
    router.push("/");
    router.refresh();
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await postJson("/api/auth/login", { email, password });
    setBusy(false);
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
    await done();
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
    await done();
  }

  if (step.name === "new-password") {
    return (
      <form onSubmit={submitNewPassword} className="space-y-5" noValidate>
        <h1 className="text-2xl font-bold">パスワードを決める</h1>
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
      <h1 className="text-2xl font-bold">ログイン</h1>
      <p className="text-muted">招待されたメールアドレスで、ログインしてください。</p>
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
      <p className="text-sm">
        <Link href="/forgot-password" className="text-primary underline">
          パスワードを忘れたとき
        </Link>
      </p>
    </form>
  );
}
