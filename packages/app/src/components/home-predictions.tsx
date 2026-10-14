"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PredictionCard } from "@/components/prediction-card.tsx";
import { type ExamEntry, type ExamSummary, loadSummaries } from "@/lib/history/summaries.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";

/** トップに出す、受験歴のある資格の合格予測のカード。受験歴がないときは、始め方を案内する。 */
export function HomePredictions({ entries }: { entries: ExamEntry[] }) {
  const [summaries, setSummaries] = useState<ExamSummary[] | null>(null);
  const owner = useStorageOwner();

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない(印が取れたら、読み直す)
    if (owner === undefined) return;
    let active = true;
    void loadSummaries(entries).then((loaded) => {
      if (active) setSummaries(loaded);
    });
    return () => {
      active = false;
    };
  }, [entries, owner]);

  if (summaries === null) return null;

  const predicted = summaries.flatMap(({ entry, summary }) =>
    summary.prediction ? [{ exam: entry.exam, prediction: summary.prediction }] : [],
  );

  return (
    <div className="space-y-3">
      <h2 className="h2">合格予測</h2>
      {predicted.length === 0 ? (
        <p className="card-dashed p-4 text-sm text-muted">
          まだ受験した結果がありません。問題を解くと、資格ごとの合格予測がここに出ます。
        </p>
      ) : (
        <>
          <ul className="motion-stagger grid gap-3 sm:grid-cols-2">
            {predicted.map(({ exam, prediction }) => (
              <li key={exam.examCode}>
                <PredictionCard exam={exam} prediction={prediction} />
              </li>
            ))}
          </ul>
          <Link href="/achievements" className="inline-block text-sm text-primary hover:underline">
            実績を見る
          </Link>
        </>
      )}
    </div>
  );
}
