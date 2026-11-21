"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { examCodeOf } from "@/lib/nav.ts";

/** 試験についてのお問い合わせの画面の URL */
export function examContactHref(examCode: string): string {
  return `/contact?${new URLSearchParams({ exam: examCode }).toString()}`;
}

/**
 * フッターに置く「お問い合わせ」のリンク。試験の画面(`exams/[code]/` の下)では、その資格コードを付けて開く
 * (開いた先で、その試験についてか全般かを選ぶ)。それ以外の画面では、資格コードを付けずに開く。
 * 資格が公開中かどうかは、開いた先の `/contact` が確かめる(docs/app/specs/feedback.md)。
 */
export function ContactLink({ className }: { className?: string }) {
  const examCode = examCodeOf(usePathname());
  return (
    <Link href={examCode ? examContactHref(examCode) : "/contact"} className={className}>
      お問い合わせ
    </Link>
  );
}
