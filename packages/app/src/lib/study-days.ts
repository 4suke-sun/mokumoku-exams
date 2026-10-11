/** 日付(日本時間の暦日)は `YYYY-MM-DD` の形で扱う。 */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 日本時間は UTC より 9 時間進んでいる(夏時間はない)。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 1 日分の学習量。`answered` は解いた問題の数、`correct` はそのうちの正解の数。 */
export type StudyDay = { date: string; answered: number; correct: number };

/** 時刻(ISO 8601 か、ミリ秒)の、日本時間での日付。 */
export function jstDate(time: string | number): string {
  const ms = typeof time === "number" ? time : Date.parse(time);
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 実在する日付か(`2026-02-30` のような日付は断る)。 */
export function isValidDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === date;
}

/** 日付に日数を足す(負の数で戻る)。 */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** `from` から `to` までの日数(`to` が前なら負)。 */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

/** 曜日(0 が日曜)。 */
const weekday = (date: string) => new Date(`${date}T00:00:00.000Z`).getUTCDay();

/**
 * 連続して学習した日数。今日か昨日まで続いているものだけを数える(今日まだ解いていなくても、昨日まで続いていれば途切れない)。
 * 1 問以上解いた日を、学習した日とみなす。
 */
export function streakDays(days: readonly StudyDay[], today: string): number {
  const studied = new Set(days.filter((d) => d.answered > 0).map((d) => d.date));
  let cursor = studied.has(today) ? today : addDays(today, -1);
  let count = 0;
  while (studied.has(cursor)) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

/** ヒートマップの 1 マス。今日より先の日は、`answered` が null。 */
export type HeatCell = { date: string; answered: number | null };

/**
 * 直近 `weeks` 週のヒートマップ。週は日曜から土曜までで、最後の週が今日を含む週。
 * 戻り値は週ごとの配列(古い順)で、それぞれ日曜から土曜までの 7 マス。
 */
export function heatmapWeeks(days: readonly StudyDay[], today: string, weeks = 12): HeatCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d.answered]));
  const start = addDays(today, -weekday(today) - (weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      return { date, answered: date > today ? null : (byDate.get(date) ?? 0) };
    }),
  );
}

/** ヒートマップの濃さ(0 は学習なし、4 がいちばん濃い)。 */
export function heatLevel(answered: number): 0 | 1 | 2 | 3 | 4 {
  if (answered <= 0) return 0;
  if (answered < 5) return 1;
  if (answered < 10) return 2;
  if (answered < 20) return 3;
  return 4;
}
