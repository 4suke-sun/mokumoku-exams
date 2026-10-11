import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { authenticateAdmin } from "@/lib/auth/admin.ts";
import { guardDeps } from "@/lib/auth/deps.ts";

/** いまのリクエストの利用者が管理者か。設定の不備などで確かめられないときも、管理者ではないとする。 */
async function isAdminRequest(): Promise<boolean> {
  try {
    return (await authenticateAdmin((await headers()).get("cookie"), guardDeps())) !== null;
  } catch {
    return false;
  }
}

/**
 * 管理者の画面(`/admin` 以下)の共通の枠。入口(proxy)とは別に、ここでも ID トークンをサーバー側で検証し、
 * 管理者でなければ(未ログイン・検証の失敗を含む)ホームへ移す。配下に足した画面も、この確認を通る。
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await isAdminRequest())) redirect("/");
  return children;
}
