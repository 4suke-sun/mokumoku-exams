import type { Metadata } from "next";
import { AccountView } from "@/components/account-view.tsx";

export const metadata: Metadata = { title: "アカウント" };

export default function AccountPage() {
  return <AccountView />;
}
