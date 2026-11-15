import Link from "next/link";

/** 問題の誤りの報告の画面の URL */
export function reportHref(examCode: string, questionId: string): string {
  const query = new URLSearchParams({ exam: examCode, id: questionId });
  return `/contact/question?${query.toString()}`;
}

/** 問題の下に置く、誤りの報告のリンク(管理者のプレビューには置かない) */
export function ReportLink({ examCode, questionId }: { examCode: string; questionId: string }) {
  return (
    <p className="text-right text-sm">
      <Link href={reportHref(examCode, questionId)} className="text-muted underline hover:text-fg">
        この問題の誤りを報告
      </Link>
    </p>
  );
}
