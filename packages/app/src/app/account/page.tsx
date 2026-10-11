import type { Metadata } from "next";
import { AccountView } from "@/components/account-view.tsx";

export const metadata: Metadata = { title: "アカウント" };

// 通知の公開鍵を、ビルドのときではなく、実行の環境(Lambda の環境変数)から読む
export const dynamic = "force-dynamic";

export default function AccountPage() {
  return <AccountView pushPublicKey={process.env.VAPID_PUBLIC_KEY || null} />;
}
