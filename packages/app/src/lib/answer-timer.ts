import { MAX_ANSWER_TIME_MS } from "./storage.ts";

// 問題ごとの回答時間を数える。今の問題を表示していて、タブが見えている間だけを数える(タブが隠れている間は数えない)。
// 時刻は外から渡し、時計を差し替えて単体テストできるようにする。

export type AnswerTimer = {
  /** 数えている問題の番号。数えていないときは null */
  index: number | null;
  /** 数え始めた時刻(ミリ秒)。タブが隠れているときは null */
  since: number | null;
  /** 問題の番号ごとの、数え終えた時間(ミリ秒) */
  totals: number[];
};

/** 出題の始め(または再開)の状態。保存していた時間から続けて数える */
export function createTimer(totals: readonly number[]): AnswerTimer {
  return { index: null, since: null, totals: [...totals] };
}

/** 数えている分を足し込む(上限で止める) */
function settle(timer: AnswerTimer, now: number): number[] {
  if (timer.index === null || timer.since === null) return timer.totals;
  const totals = [...timer.totals];
  const elapsed = Math.max(0, now - timer.since);
  totals[timer.index] = Math.min(MAX_ANSWER_TIME_MS, Math.round((totals[timer.index] ?? 0) + elapsed));
  return totals;
}

/** 表示する問題が変わった。前の問題の分を足し込み、見えていれば新しい問題を数え始める */
export function showQuestion(timer: AnswerTimer, index: number, visible: boolean, now: number): AnswerTimer {
  return { index, since: visible ? now : null, totals: settle(timer, now) };
}

/** タブの見え方が変わった。隠れたら足し込んで止め、見えたら数え始める */
export function setVisible(timer: AnswerTimer, visible: boolean, now: number): AnswerTimer {
  if (visible) return timer.since === null && timer.index !== null ? { ...timer, since: now } : timer;
  return { ...timer, since: null, totals: settle(timer, now) };
}

/** ここまでの時間(数えている分も含む)。`count` の長さにそろえる */
export function elapsedTimes(timer: AnswerTimer, count: number, now: number): number[] {
  const totals = settle(timer, now);
  return Array.from({ length: count }, (_, i) => totals[i] ?? 0);
}
