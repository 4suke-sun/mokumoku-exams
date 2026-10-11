import type { Metadata } from "next";

export const metadata: Metadata = { title: "管理" };

export default function AdminPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">管理</h1>
      <p className="text-sm text-muted">この画面は、管理者のグループに入っているアカウントだけが開けます。</p>
    </section>
  );
}
