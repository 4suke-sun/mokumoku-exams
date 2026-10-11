import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form.tsx";
import { safeNext } from "@/lib/auth/redirect.ts";

export const metadata: Metadata = { title: "ログイン" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <LoginForm next={safeNext(typeof next === "string" ? next : undefined)} />
    </div>
  );
}
