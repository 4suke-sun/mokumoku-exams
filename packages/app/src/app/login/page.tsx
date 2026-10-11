import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form.tsx";

export const metadata: Metadata = { title: "ログイン" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md">
      <LoginForm />
    </div>
  );
}
