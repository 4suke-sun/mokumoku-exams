import type { Metadata } from "next";
import { SignupForm } from "@/components/signup-form.tsx";

export const metadata: Metadata = { title: "新規登録" };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-md">
      <SignupForm />
    </div>
  );
}
