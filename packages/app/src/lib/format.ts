/** 日時の表示(日本の形式。読み取れない値は空) */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

/** 回答時間の表示(秒。1 分以上は分と秒) */
export function formatAnswerTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
