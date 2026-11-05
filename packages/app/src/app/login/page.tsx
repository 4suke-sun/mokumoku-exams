import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form.tsx";
import { safeNext } from "@/lib/auth/redirect.ts";

export const metadata: Metadata = { title: "ログイン" };

// 退会のあとは `/login?deleted=1` へ移り、「退会しました」を出す
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; deleted?: string | string[] }>;
}) {
  const { next, deleted } = await searchParams;
  return (
    <div className="mx-auto max-w-md">
      <LoginForm next={safeNext(typeof next === "string" ? next : undefined)} deleted={deleted === "1"} />
    </div>
  );
}
