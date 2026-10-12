import Link from "next/link";
import { predictionMessage } from "@/components/prediction-panel.tsx";
import type { Prediction } from "@/lib/dashboard.ts";
import type { PublishedExam } from "@/lib/types.ts";

/** 資格ごとの合格予測の小さなカード。資格ごとの学習の状況へのリンクにする。 */
export function PredictionCard({ exam, prediction }: { exam: PublishedExam; prediction: Prediction }) {
  const tone = prediction.reached ? "text-correct" : "text-warn";
  return (
    <Link
      href={`/exams/${exam.examCode}/dashboard`}
      className={`card space-y-1 border-l-4 p-4 ${prediction.reached ? "border-l-correct" : "border-l-warn"}`}
    >
      <span className="block text-sm text-muted">{exam.shortName}の合格予測</span>
      <span className={`block text-3xl font-bold ${tone}`}>{prediction.percent}%</span>
      <span className={`block text-sm font-bold ${tone}`}>
        <span aria-hidden="true">{prediction.reached ? "✓ " : "△ "}</span>
        {predictionMessage(prediction)}
      </span>
    </Link>
  );
}
