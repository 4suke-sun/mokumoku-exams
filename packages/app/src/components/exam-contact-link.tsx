"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { examCodeOf } from "@/lib/nav.ts";

/** 試験についてのお問い合わせの画面の URL */
export function examContactHref(examCode: string): string {
  return `/contact?${new URLSearchParams({ exam: examCode }).toString()}`;
}

/**
 * フッターに置く「この試験についてお問い合わせ」のリンク。試験の画面(`exams/[code]/` の下)にだけ出す。
 * 資格が公開中かどうかは、開いた先の `/contact` が確かめる(docs/app/specs/feedback.md)。
 */
export function ExamContactLink({ className }: { className?: string }) {
  const examCode = examCodeOf(usePathname());
  if (!examCode) return null;
  return (
    <Link href={examContactHref(examCode)} className={className}>
      この試験についてお問い合わせ
    </Link>
  );
}
