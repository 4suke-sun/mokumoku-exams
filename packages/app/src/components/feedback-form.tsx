"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { requestJson } from "@/lib/api/client.ts";
import {
  CONTACT_CATEGORIES,
  type FeedbackRequest,
  MAX_FEEDBACK_TEXT_LENGTH,
  QUESTION_CATEGORIES,
} from "@/lib/feedback/schema.ts";
import { FormError, SubmitButton } from "./form-parts.tsx";
import { Notice } from "./notice.tsx";
import { useSession } from "./session-provider.tsx";

// 送信フォーム(お問い合わせ・問題の誤りの報告)の共通の部品。仕様は docs/app/specs/feedback.md。

/** 送信の画面に出す注意(返信しないことと、公開されうること) */
export function FeedbackCaution() {
  return (
    <div className="space-y-1 text-sm text-muted">
      <p>返信はしません。</p>
      <p>
        送った内容は、GitHub の Issue として起票され、公開されることがあります。メールアドレスなどの個人情報や、
        公開されて困ること・人を傷つけることを書かないでください。
      </p>
    </div>
  );
}

/** 種類の選択。ボタンの並びから 1 つを選ぶ(ラジオの役割) */
function CategoryPicker<K extends string>(props: {
  legend: string;
  options: Record<K, string>;
  value: K | null;
  onChange: (value: K) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-bold">{props.legend}</legend>
      <div className="flex flex-wrap gap-2">
        {(Object.entries(props.options) as [K, string][]).map(([key, label]) => {
          const on = props.value === key;
          return (
            <label
              key={key}
              className={`cursor-pointer rounded-md border px-3 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${
                on ? "border-primary bg-soft font-bold" : "border-line bg-surface"
              }`}
            >
              <input
                type="radio"
                name="category"
                value={key}
                checked={on}
                onChange={() => props.onChange(key)}
                className="sr-only"
              />
              {label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** 送れたときの表示(お礼の言葉)。返信しないことは、送る前の注意(`FeedbackCaution`)で伝える */
const SENT_MESSAGES = {
  contact:
    "お問い合わせを受け付けました。ありがとうございます。いただいた内容は、今後の改善の参考にさせていただきます。",
  question: "ご報告ありがとうございます。いただいた内容をもとに、問題を確認します。",
} as const;

/** 失敗の応答を、利用者に見せる文言にする */
function failureMessage(status: number): string {
  if (status === 429) return "今日はこれ以上送れません。明日またお試しください。";
  if (status === 400) return "送れませんでした。入力を確かめてください。";
  return "いまは送れません。時間をおいてお試しください。";
}

type Props =
  | { form: "contact" }
  | { form: "question"; examCode: string; questionId: string; children?: ReactNode; backLink?: ReactNode };

/** お問い合わせと、問題の誤りの報告のフォーム。送れたら入力を空にし、失敗したら入力を残す。 */
export function FeedbackForm(props: Props) {
  const { reload } = useSession();
  const [category, setCategory] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const isContact = props.form === "contact";
  const length = [...text.trim()].length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    if (!category) return setError("種類を選んでください。");
    if (isContact && length === 0) return setError("内容を書いてください。");
    if (length > MAX_FEEDBACK_TEXT_LENGTH) return setError(`${MAX_FEEDBACK_TEXT_LENGTH} 文字以内で書いてください。`);
    const body = (
      props.form === "contact"
        ? { form: "contact", category, text }
        : { form: "question", category, text, examCode: props.examCode, questionId: props.questionId }
    ) as FeedbackRequest;
    setBusy(true);
    setError(null);
    const result = await requestJson("/api/feedback", { method: "POST", body });
    setBusy(false);
    if (!result.ok) {
      if (result.kind === "session-expired") {
        setError("ログインの期限が切れました。もう一度ログインしてください。");
        await reload();
        return;
      }
      return setError(failureMessage(result.status));
    }
    setCategory(null);
    setText("");
    setSent(true);
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {props.form === "question" ? props.children : null}
      {isContact ? (
        <CategoryPicker legend="種類" options={CONTACT_CATEGORIES} value={category} onChange={setCategory} />
      ) : (
        <CategoryPicker legend="誤りの種類" options={QUESTION_CATEGORIES} value={category} onChange={setCategory} />
      )}
      <div className="space-y-1">
        <label htmlFor="feedback-text" className="block font-bold">
          {isContact ? "内容" : "補足(空でもかまいません)"}
        </label>
        <textarea
          id="feedback-text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="feedback-text-hint"
          required={isContact}
          className="min-h-40 w-full rounded-md border border-line bg-surface p-3"
        />
        <p id="feedback-text-hint" className="text-sm text-muted">
          {length} / {MAX_FEEDBACK_TEXT_LENGTH} 文字
        </p>
      </div>
      <FeedbackCaution />
      <FormError message={error} />
      {sent ? <Notice kind="success">{SENT_MESSAGES[props.form]}</Notice> : null}
      {sent && props.form === "question" ? props.backLink : null}
      <SubmitButton busy={busy}>送る</SubmitButton>
    </form>
  );
}
