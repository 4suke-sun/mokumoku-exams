import type { Metadata } from "next";
import Link from "next/link";
import { BackLink } from "@/components/back-link.tsx";
import { FeedbackForm } from "@/components/feedback-form.tsx";
import { LoginRequired } from "@/components/login-required.tsx";
import { Notice } from "@/components/notice.tsx";
import { findPublishedExam } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "お問い合わせ" };

/**
 * お問い合わせの画面。`?exam=<資格コード>` が付いたとき(試験の画面のフッターから開いたとき)は、
 * 対象(その試験についてか、全般か)を選ばせ、試験についてを選んだときだけ資格コードを添える。
 * `exam` が公開中の資格に一致しない(空・形の外れ・複数を含む)ときは、フォームを出さず、試験なしの画面へのリンクを出す。
 * 画面はログインなしで開けるが、送るにはログインが要る。ログインしていなければ、フォームの代わりに、ログインへの案内を出す
 * (ログインのあとは、この画面に戻る)。
 */
export default async function ContactPage({ searchParams }: { searchParams: Promise<{ exam?: string | string[] }> }) {
  const { exam: examCode } = await searchParams;
  const withExam = examCode !== undefined;
  const exam = typeof examCode === "string" ? findPublishedExam(examCode) : undefined;

  return (
    <section className="space-y-6">
      <p>
        <BackLink />
      </p>
      <h1 className="h1">お問い合わせ</h1>
      <p>不具合や要望を、開発者へ送れます。</p>
      {!withExam ? (
        <LoginRequired action="お問い合わせを送る" next="/contact">
          <FeedbackForm form="contact" backLink={<BackLink />} />
        </LoginRequired>
      ) : exam ? (
        <LoginRequired
          action="お問い合わせを送る"
          next={`/contact?${new URLSearchParams({ exam: exam.examCode }).toString()}`}
        >
          <FeedbackForm form="contact" exam={{ examCode: exam.examCode, name: exam.name }} backLink={<BackLink />} />
        </LoginRequired>
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
