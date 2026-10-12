import type { Metadata } from "next";
import Link from "next/link";
import { AdminView } from "@/components/admin-view.tsx";

export const metadata: Metadata = { title: "管理" };

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <AdminView />
      <section aria-labelledby="admin_preview-title" className="space-y-2">
        <h2 id="admin_preview-title" className="h2">
          全問のプレビュー
        </h2>
        <p className="text-sm text-muted">資格ごとに、全問の正解・解説・出典を一覧して、校正できます。</p>
        <Link href="/admin/preview" className="inline-block text-primary hover:underline">
          全問のプレビューを開く
        </Link>
      </section>
    </div>
  );
}
