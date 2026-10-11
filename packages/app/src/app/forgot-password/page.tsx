import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forgot-password-form.tsx";

export const metadata: Metadata = { title: "パスワードの再設定" };

export default function ForgotPasswordPage() {
  return (
    <div className="mx-auto max-w-md">
      <ForgotPasswordForm />
    </div>
  );
}
