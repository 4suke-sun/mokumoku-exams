import { heatLevel, heatmapWeeks, type StudyDay, streakDays } from "@/lib/study-days.ts";

/** ヒートマップの濃さごとの色(0 は学習なし)。凡例も同じ色を使う */
const HEAT_CLASSES = ["bg-line", "bg-correct/25", "bg-correct/50", "bg-correct/75", "bg-correct"];
const HEATMAP_WEEKS = 12;

/** 凡例の文字(段階ごとの、1 日に解いた問題数) */
const HEAT_LABELS = ["0 問", "1〜4 問", "5〜9 問", "10〜19 問", "20 問以上"];

/** 日ごとの学習量(連続日数と、直近 12 週の緑の濃淡のカレンダー、凡例)。 */
export function StudyCalendar({ days, today, scope }: { days: StudyDay[] | null; today: string; scope: string }) {
  if (days === null) {
    return (
      <div className="space-y-2">
        <h2 className="h2">日ごとの学習量</h2>
        <p className="text-sm text-muted">アカウントから読み込めないため、いまは表示できません。</p>
      </div>
    );
  }
  const weeks = heatmapWeeks(days, today, HEATMAP_WEEKS);
  const studied = weeks.flat().filter((cell) => (cell.answered ?? 0) > 0).length;
  return (
    <div className="space-y-3">
      <h2 className="h2">日ごとの学習量</h2>
      <p className="font-bold">連続 {streakDays(days, today)} 日</p>
      <div className="card space-y-2 p-4">
        <div
          role="img"
          aria-label={`直近 ${HEATMAP_WEEKS} 週のうち、学習した日は ${studied} 日です。`}
          className="flex gap-1"
        >
          {weeks.map((week) => (
            <div key={week[0]?.date} className="flex flex-col gap-1">
              {week.map((cell) =>
                cell.answered === null ? (
                  <span key={cell.date} className="size-4" />
                ) : (
                  <span
                    key={cell.date}
                    title={`${cell.date}: ${cell.answered} 問`}
                    className={`size-4 rounded-sm ${HEAT_CLASSES[heatLevel(cell.answered)]}`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
        <ul aria-label="色の凡例" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {HEAT_CLASSES.map((color, level) => (
            <li key={color} className="flex items-center gap-1">
              <span aria-hidden="true" className={`size-3 rounded-sm ${color}`} />
              {HEAT_LABELS[level]}
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          直近 {HEATMAP_WEEKS} 週(列が週で、上が日曜)。色が濃いほど、その日に多く解いています。
          {scope}のアカウントに保存した結果を、完了した日(日本時間)で数えます。
        </p>
      </div>
    </div>
  );
}
