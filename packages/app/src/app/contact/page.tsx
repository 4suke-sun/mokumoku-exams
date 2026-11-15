import type { Metadata } from "next";
import { FeedbackForm } from "@/components/feedback-form.tsx";

export const metadata: Metadata = { title: "お問い合わせ" };

export default function ContactPage() {
  return (
    <section className="space-y-6">
      <h1 className="h1">お問い合わせ</h1>
      <p>不具合や要望を、開発者へ送れます。</p>
      <FeedbackForm form="contact" />
    </section>
  );
}
