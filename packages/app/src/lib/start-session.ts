import { newSession } from "./quiz.ts";
import { type KeyValueStore, loadSettings, type Session, saveSession } from "./storage.ts";

/** 出題の状態を保存できなかったときの案内 */
export const SESSION_SAVE_FAILED = "この端末では、出題の状態を保存できません。ブラウザの設定を確認してください。";

/** 出題の画面の場所 */
export const playPath = (examCode: string) => `/exams/${examCode}/play`;

/** 出題の状態を保存して、出題の画面の場所を返す。保存できなければ null(呼び出し側が `SESSION_SAVE_FAILED` を示す)。 */
export function saveAndLocate(store: KeyValueStore, session: Session): string | null {
  return saveSession(store, session) ? playPath(session.examCode) : null;
}

type Item = { questionId: string; choiceKeys: readonly string[] };

/**
 * 端末の設定(選択肢のシャッフルと解答の表示のしかた)で出題を組み立てて保存し、出題の画面の場所を返す。
 * セクションや段階の出題は、その印(`section`・`stage`)を付ける。保存できなければ null。
 */
export function startSession(
  store: KeyValueStore,
  examCode: string,
  items: readonly Item[],
  marks: Pick<Session, "section" | "stage"> = {},
  random: () => number = Math.random,
  now: Date = new Date(),
): string | null {
  const { shuffleChoices, reveal } = loadSettings(store);
  const session: Session = { ...newSession(examCode, items, { shuffleChoices }, random, now), ...marks };
  return saveAndLocate(store, reveal === "each" ? { ...session, reveal } : session);
}
