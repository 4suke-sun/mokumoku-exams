import type { Metadata } from "next";
import Link from "next/link";
import { DomainMenu } from "@/components/domain-menu.tsx";
import { listExams } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "資格を選ぶ" };

export default function ExamsPage() {
  const exams = listExams();

  return (
    <section className="space-y-6">
      <h1 className="h1">資格を選ぶ</h1>
      <p className="text-muted">学習する資格を選んでください。</p>
      <ul className="motion-stagger space-y-3">
        {exams.map((exam) => (
          <li key={exam.examCode}>
            {exam.status === "published" ? (
              <div className="card space-y-3 p-4">
                <Link href={`/exams/${exam.examCode}`} className="block hover:underline">
                  <span className="block text-sm text-muted">{exam.vendor}</span>
                  <span className="block text-lg font-bold">{exam.name}</span>
                  <span className="mt-1 block text-sm text-muted">
                    {exam.officialQuestionCount} 問 / {exam.officialTimeMinutes} 分 / 合格 {exam.passingScore} 点 (満点{" "}
                    {exam.totalScore} 点)
                  </span>
                </Link>
                <DomainMenu exam={exam} />
              </div>
            ) : (
              <div className="card-dashed p-4">
                <span className="block text-sm text-muted">{exam.vendor}</span>
                <span className="block text-lg font-bold text-muted">{exam.name}</span>
                <span className="mt-1 block text-sm text-warn">{exam.note ?? "近日公開予定です。"}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
