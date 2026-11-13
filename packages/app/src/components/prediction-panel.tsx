import Link from "next/link";
import { type BarRow, DomainBars } from "@/components/domain-bars.tsx";
import { ScoreRing } from "@/components/score-ring.tsx";
import { type DomainPrediction, PREDICTION_WINDOW, PRIORITY_LIMIT, type Prediction } from "@/lib/dashboard.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { formatAnswerTime } from "@/lib/format.ts";
import { domainSelectHref } from "@/lib/quiz.ts";
import type { PublishedExam } from "@/lib/types.ts";

/** 合格ラインまでの差の文(「あと n ポイント」)。届いているときは見込みを伝える。 */
export function predictionMessage(prediction: Prediction): string {
  return prediction.reached
    ? `合格ライン(${prediction.passLine}%)に届く見込みです。`
    : `合格ライン(${prediction.passLine}%)まで、あと ${prediction.gap} ポイントです。`;
}

function rowFor(exam: PublishedExam, row: DomainPrediction, names: Map<string, string>): BarRow {
  const color = domainColorClasses(exam.domains, row.domain);
  const time = row.avgTimeMs === null ? "" : `、平均 ${formatAnswerTime(row.avgTimeMs)}/問`;
  return {
    key: row.domain,
    label: names.get(row.domain) ?? row.domain,
    percent: row.percent,
    detail: row.substituted
      ? `出題なし(全体の正答率 ${row.percent}% で代用)`
      : `${row.percent}%(${row.answered} 問${time})`,
    textClass: color?.text,
    barClass: row.belowLine ? "bg-orange" : (color?.bar ?? "bg-primary"),
    warn: row.belowLine,
  };
}

/** 資格の合格予測。配点で重み付けした予測と、合格ラインまでの差、優先して復習したい分野を示す。 */
export function PredictionPanel({ exam, prediction }: { exam: PublishedExam; prediction: Prediction }) {
  const names = new Map(exam.domains.map((d) => [d.code, d.name]));
  return (
    <div className="space-y-3">
      <h2 className="h2">合格予測</h2>
      <div className="card flex flex-col items-center gap-5 p-5 sm:flex-row">
        <ScoreRing percent={prediction.percent} reached={prediction.reached} />
        <div className="space-y-2">
          <p className={`font-bold ${prediction.reached ? "text-correct" : "text-warn"}`}>
            {predictionMessage(prediction)}
          </p>
          <p className="text-sm text-muted">
            直近 {prediction.basedOn} 回(最大 {PREDICTION_WINDOW} 回)の結果を分野ごとに集計し、分野の配点で重み付けして
            予測します。出題のない分野は、全体の正答率で代わりにします。回数が少ないうちは、ぶれが大きくなります。
          </p>
        </div>
      </div>

      {prediction.priorities.length > 0 ? (
        <div className="card space-y-3 p-4">
          <h3 className="h3">優先して復習したい分野(上位 {PRIORITY_LIMIT} 件)</h3>
          <p className="text-sm text-muted">配点が大きく、取りこぼしの多い分野から並べます。</p>
          <DomainBars
            caption="優先して復習したい分野"
            rows={prediction.priorities.map((row) => rowFor(exam, row, names))}
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {prediction.priorities.map((row) => (
              <li key={row.domain}>
                <Link href={domainSelectHref(exam.examCode, row.domain)} className="text-primary hover:underline">
                  {names.get(row.domain) ?? row.domain}を解く
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="card p-4">
        <summary className="cursor-pointer font-bold">分野ごとの配点・正答率・平均回答時間</summary>
        <table className="mt-3 w-full text-left text-sm tabular-nums">
          <caption className="sr-only">分野ごとの配点・正答率・平均回答時間</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">
                分野
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                配点
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                正答率
              </th>
              <th scope="col" className="py-1 font-normal">
                平均回答時間
              </th>
            </tr>
          </thead>
          <tbody>
            {prediction.domains.map((row) => (
              <tr key={row.domain} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-3 font-bold">
                  {names.get(row.domain) ?? row.domain}
                </th>
                <td className="py-2 pr-3">{Math.round(row.weight * 1000) / 10}%</td>
                <td className="py-2 pr-3">{row.substituted ? "出題なし" : `${row.percent}%`}</td>
                <td className="py-2">{row.avgTimeMs === null ? "-" : `${formatAnswerTime(row.avgTimeMs)}/問`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
