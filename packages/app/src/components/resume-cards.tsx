"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionProgress } from "@/lib/quiz.ts";
import { browserStore, loadSession, type Session } from "@/lib/storage.ts";

type ExamItem = { examCode: string; name: string; questionIds: string[] };

type Props = { exams: ExamItem[] };

type Resumable = { exam: ExamItem; session: Session };

/** 端末に保存した出題の途中の状態を、資格ごとに「前回の続き」のカードで示す。新しく始めた順に並べる。 */
export function ResumeCards({ exams }: Props) {
  const [items, setItems] = useState<Resumable[]>([]);

  useEffect(() => {
    const store = browserStore();
    const found: Resumable[] = [];
    for (const exam of exams) {
      const session = loadSession(store, exam.examCode);
      // 出題中の問題が、いまのデータにすべてあるときだけ続きから解ける(出題の画面と同じ条件)
      const ids = new Set(exam.questionIds);
      if (session?.questionIds.every((id) => ids.has(id))) found.push({ exam, session });
    }
    found.sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt));
    setItems(found);
  }, [exams]);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold">前回の続き</h2>
      <ul className="space-y-3">
        {items.map(({ exam, session }) => {
          const { answered, total } = sessionProgress(session);
          return (
            <li key={exam.examCode} className="space-y-3 rounded-lg border border-primary bg-surface p-4">
              <div className="space-y-1">
                <p className="font-bold">{exam.name}</p>
                <p className="text-sm text-muted">
                  {total} 問中 {answered} 問に回答しています。
                </p>
              </div>
              <Link
                href={`/exams/${exam.examCode}/play`}
                aria-label={`${exam.name}を続きから解く`}
                className="block rounded-md bg-primary px-5 py-3 text-center font-bold text-on-primary hover:opacity-90"
              >
                続きから解く
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
