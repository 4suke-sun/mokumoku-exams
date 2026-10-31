import { type GradableQuestion, score } from "./quiz.ts";
import { retryPassRecord } from "./sections.ts";
import {
  type KeyValueStore,
  loadSectionProgress,
  type Result,
  type SectionProgress,
  type Session,
  saveResult,
  saveSectionCheck,
  saveSectionRetry,
  saveStageCheck,
} from "./storage.ts";
import { isStagePassed } from "./study-stages.ts";

// 出題を終えたときの、結果の組み立てと保存。画面から切り離した関数にして、単体テストする。

/** 印が 1 つでもあるときだけ残す(印のない結果は、項目を持たない) */
export function marksIfAny(list: readonly boolean[]): boolean[] | undefined {
  return list.some(Boolean) ? [...list] : undefined;
}

/** 出題の状態から、採点に送る結果を組み立てる。 */
export function resultOf(
  session: Session,
  values: { finishedAt: Date; timesMs: number[]; unsure: readonly boolean[]; flagged: readonly boolean[] },
): Result {
  return {
    examCode: session.examCode,
    questionIds: session.questionIds,
    answers: session.answers,
    textAnswers: session.textAnswers,
    finishedAt: values.finishedAt.toISOString(),
    choiceOrder: session.choiceOrder,
    timesMs: values.timesMs,
    unsure: marksIfAny(values.unsure),
    flagged: marksIfAny(values.flagged),
  };
}

/** 結果の保存先。`failed` は、アカウントにも端末にも残せなかった */
export type SavedTo = "server" | "local" | "failed";

/**
 * 結果を保存する。アカウントに保存できたら、サーバーを正とする。保存できないとき(通信の失敗など)は、
 * この端末に残して、あとで移せるようにする。
 */
export async function saveFinishedResult(
  store: KeyValueStore,
  result: Result,
  post: (result: Result) => Promise<boolean>,
): Promise<SavedTo> {
  if (await post(result)) return "server";
  return saveResult(store, result) ? "local" : "failed";
}

/**
 * 段階の確認問題とセクションの出題の記録を残す(残せなくても、結果は保存済みなので先へ進む)。
 * - 段階: 正答率で合否を決め、到達の状態を端末に残す。
 * - セクション: 正答数を、そのセクションの記録として端末に残し、サーバーにも送る(別の端末で開いても、同じ進捗になる)。
 *   送れなくても、端末には残っていて、次に一覧を開いたときに取り込む。
 */
export function recordSessionChecks(
  store: KeyValueStore,
  session: Session,
  asked: readonly GradableQuestion[],
  finishedAt: string,
  putSections: (progress: SectionProgress) => Promise<unknown>,
): void {
  if (!session.stage && session.section === undefined && session.retryOf === undefined) return;
  const { correct, total, percent } = score(asked, session.answers, session.textAnswers);
  if (session.stage) {
    saveStageCheck(store, session.examCode, { ...session.stage, percent, passed: isStagePassed(percent), finishedAt });
  }
  if (session.section !== undefined && total > 0) {
    const record = { correct, total, finishedAt };
    saveSectionCheck(store, session.examCode, session.section, record);
    void putSections({
      examCode: session.examCode,
      best: { [String(session.section)]: record },
      last: { ...record, section: session.section },
    });
  }
  // セクションの解き直し: 解き直した問題をすべて正解したら、未達のセクションを合格に上げる(満点にはしない)
  if (session.retryOf !== undefined && total > 0) {
    const key = String(session.retryOf);
    const progress = loadSectionProgress(store, session.examCode);
    const before = Object.hasOwn(progress.best, key) ? progress.best[key] : undefined;
    const upgraded = retryPassRecord(before, { correct, total }, finishedAt);
    saveSectionRetry(store, session.examCode, session.retryOf, { correct, total, finishedAt }, upgraded);
    if (upgraded) {
      void putSections({
        examCode: session.examCode,
        best: { [key]: upgraded },
        last: { ...upgraded, section: session.retryOf },
      });
    }
  }
}
