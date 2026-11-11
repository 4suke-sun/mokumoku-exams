"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionProgress } from "@/lib/quiz.ts";
import { browserStore, loadSession, type Session } from "@/lib/storage.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";

type ExamItem = { examCode: string; name: string; questionIds: string[] };

type Props = { exams: ExamItem[] };

type Resumable = { exam: ExamItem; session: Session };

/** 端末に保存した出題の途中の状態を、資格ごとに「前回の続き」のカードで示す。新しく始めた順に並べる。 */
export function ResumeCards({ exams }: Props) {
  const [items, setItems] = useState<Resumable[]>([]);
  const owner = useStorageOwner();

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない(印が取れたら、読み直す)
    if (owner === undefined) return;
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
  }, [exams, owner]);

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="h2">前回の続き</h2>
      <ul className="space-y-3">
        {items.map(({ exam, session }) => {
          const { answered, total } = sessionProgress(session);
          const percent = total === 0 ? 0 : Math.round((answered / total) * 100);
          return (
            // 面は、ほかのカードと同じ単色の面にする。強調は、縁・進み具合のバー・ボタンの点だけで使う
            <li key={exam.examCode} className="card space-y-3 border-primary p-4">
              <div className="space-y-1">
                <p className="font-bold">{exam.name}</p>
                <p className="text-sm">
                  {total} 問中 {answered} 問に回答しています。
                </p>
              </div>
              <div
                role="progressbar"
                aria-label={`${exam.name}の進み具合`}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={answered}
                aria-valuetext={`${total} 問中 ${answered} 問に回答`}
                className="h-2 w-full overflow-hidden rounded-full bg-line"
              >
                <div className="motion-bar h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
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
