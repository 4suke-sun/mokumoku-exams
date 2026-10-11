import type { ReactNode } from "react";
import { Notice } from "./notice.tsx";

const inputClass = "w-full rounded-md border border-line bg-surface px-3 py-2";

export function Field(props: {
  id: string;
  label: string;
  type?: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string;
  inputMode?: "numeric";
}) {
  const hintId = `${props.id}-hint`;
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="block font-bold">
        {props.label}
      </label>
      <input
        id={props.id}
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        aria-describedby={props.hint ? hintId : undefined}
        required
        className={inputClass}
      />
      {props.hint ? (
        <p id={hintId} className="text-sm text-muted">
          {props.hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? <Notice kind="error">{message}</Notice> : null;
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
    >
      {busy ? "処理しています…" : children}
    </button>
  );
}
