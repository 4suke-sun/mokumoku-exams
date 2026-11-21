import type { Metadata } from "next";
import Link from "next/link";
import { FeedbackForm } from "@/components/feedback-form.tsx";
import { Notice } from "@/components/notice.tsx";
import { findPublishedExam } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "お問い合わせ" };

/**
 * お問い合わせの画面。`?exam=<資格コード>` が付いたとき(試験の画面のフッターから開いたとき)は、対象の試験を表示して添える。
 * `exam` が公開中の資格に一致しない(空・形の外れ・複数を含む)ときは、フォームを出さず、試験なしの画面へのリンクを出す。
 */
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ exam?: string | string[] }> }) {
  const { exam: examCode } = await searchParams;
  const withExam = examCode !== undefined;
  const exam = typeof examCode === "string" ? findPublishedExam(examCode) : undefined;

  return (
    <section className="space-y-6">
      <h1 className="h1">お問い合わせ</h1>
      <p>不具合や要望を、開発者へ送れます。</p>
      {!withExam ? (
        <FeedbackForm form="contact" />
      ) : exam ? (
        <FeedbackForm form="contact" examCode={exam.examCode}>
          <dl className="card space-y-1 p-4 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted">資格</dt>
              <dd>{exam.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted">資格コード</dt>
              <dd>{exam.examCode}</dd>
            </div>
          </dl>
        </FeedbackForm>
      ) : (
        <>
          <Notice kind="error">対象の試験が見つかりません。</Notice>
          <p>
            <Link href="/contact" className="text-primary underline">
              試験を指定せずにお問い合わせ
            </Link>
          </p>
        </>
      )}
    </section>
  );
}
