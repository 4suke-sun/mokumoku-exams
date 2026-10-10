import { z } from "zod";

// ブラウザの localStorage に保存する学習の状態。認証のない段階の保存先で、端末の中だけに残る。
// 読み出した値は外部の入力として扱い、形を検査する。壊れていたら、保存されていないものとして扱う。

/** localStorage と同じ形の、最小の保存先。テストで差し替えられるようにする。 */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * ブラウザの localStorage。保存が禁止されていると、`window.localStorage` を参照した時点で例外になる。
 * 参照を各メソッドの中で行い、この例外を、保存の処理の try で受けられるようにする。
 */
export function browserStore(): KeyValueStore {
  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
}

const KEY_PREFIX = "mokumoku:v1";
/** 結果を残す件数(新しい順) */
export const MAX_RESULTS = 10;

// 保存された値の大きさに上限を置く(壊れた値や、手で書き換えた値で、画面が重くならないようにする)
const KEY = z.string().max(64);
const STAMP = z.string().max(64);
const AnswersSchema = z.record(KEY, z.array(z.string().max(8)).max(10)).refine((a) => Object.keys(a).length <= 1000);

/** 出題中の状態(途中で閉じても続きから解ける) */
export const SessionSchema = z.strictObject({
  examCode: KEY,
  questionIds: z.array(KEY).min(1).max(1000),
  answers: AnswersSchema,
  index: z.number().int().min(0).max(1000),
  startedAt: STAMP,
});
export type Session = z.infer<typeof SessionSchema>;

/** 採点した結果 */
export const ResultSchema = z.strictObject({
  examCode: KEY,
  questionIds: z.array(KEY).min(1).max(1000),
  answers: AnswersSchema,
  finishedAt: STAMP,
});
export type Result = z.infer<typeof ResultSchema>;

const ResultsSchema = z.array(ResultSchema).max(MAX_RESULTS);

function sessionKey(examCode: string): string {
  return `${KEY_PREFIX}:session:${examCode}`;
}

function resultsKey(examCode: string): string {
  return `${KEY_PREFIX}:results:${examCode}`;
}

/** 保存先から読み、JSON として解釈して検査する。失敗したら null(原因の詳細は出さない)。 */
function readJson<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 保存する。容量不足や保存の禁止で失敗しても、画面は続けられるので、成否だけを返す。 */
function writeJson(store: KeyValueStore, key: string, value: unknown): boolean {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(store: KeyValueStore, examCode: string): Session | null {
  const session = readJson(store, sessionKey(examCode), SessionSchema);
  return session && session.examCode === examCode ? session : null;
}

export function saveSession(store: KeyValueStore, session: Session): boolean {
  return writeJson(store, sessionKey(session.examCode), session);
}

export function clearSession(store: KeyValueStore, examCode: string): void {
  try {
    store.removeItem(sessionKey(examCode));
  } catch {
    // 消せなくても、次の出題で上書きされる
  }
}

/** 保存した結果を新しい順に返す。 */
export function loadResults(store: KeyValueStore, examCode: string): Result[] {
  const results = readJson(store, resultsKey(examCode), ResultsSchema) ?? [];
  return results.filter((r) => r.examCode === examCode);
}

/** 結果を先頭に足す。古いものは `MAX_RESULTS` 件までに切り詰める。 */
export function saveResult(store: KeyValueStore, result: Result): boolean {
  const next = [result, ...loadResults(store, result.examCode)].slice(0, MAX_RESULTS);
  return writeJson(store, resultsKey(result.examCode), next);
}
