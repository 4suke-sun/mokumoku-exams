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

/** 自由記述の回答の長さの上限(文字数。入力欄、端末の保存、サーバーの検査で共通) */
export const MAX_TEXT_ANSWER_LENGTH = 1000;

/** 問題 ID ごとの、自由記述の回答の文章 */
const TextAnswersSchema = z
  .record(KEY, z.string().max(MAX_TEXT_ANSWER_LENGTH))
  .refine((a) => Object.keys(a).length <= 1000)
  .optional();

/** 問題 ID ごとの、選択肢のキーの並び(シャッフルした順を、再読み込みしても保つ) */
const ChoiceOrderSchema = z
  .record(KEY, z.array(z.string().max(8)).max(10))
  .refine((o) => Object.keys(o).length <= 1000)
  .optional();

/** 段階の順番(カリキュラムの段階の順番と同じ範囲) */
const STAGE_ORDER = z.int().min(1).max(100);
/** 単元の ID(カリキュラムの単元の ID と同じ形。画面の URL の一部になる) */
const UNIT_ID = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/** 段階学習の段階(単元の ID と、段階の順番) */
const StageRefSchema = z.strictObject({ unitId: UNIT_ID, order: STAGE_ORDER });

/** 出題中の状態(途中で閉じても続きから解ける) */
export const SessionSchema = z.strictObject({
  examCode: KEY,
  questionIds: z.array(KEY).min(1).max(1000),
  answers: AnswersSchema,
  textAnswers: TextAnswersSchema,
  index: z.number().int().min(0).max(1000),
  startedAt: STAMP,
  choiceOrder: ChoiceOrderSchema,
  /** 段階の確認問題として始めた出題のときだけ。採点すると、その段階の到達の状態を更新する */
  stage: StageRefSchema.optional(),
  /** 本番モードの締め切り(ISO 8601)。再読み込みしても残り時間を保つ。通常の出題では持たない */
  deadline: STAMP.optional(),
});
export type Session = z.infer<typeof SessionSchema>;

/** 採点した結果 */
export const ResultSchema = z.strictObject({
  examCode: KEY,
  questionIds: z.array(KEY).min(1).max(1000),
  answers: AnswersSchema,
  textAnswers: TextAnswersSchema,
  finishedAt: STAMP,
  choiceOrder: ChoiceOrderSchema,
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

/** 端末に保存した結果を、資格ごとに消す(アカウントへ移したあとなど)。 */
export function clearResults(store: KeyValueStore, examCode: string): void {
  try {
    store.removeItem(resultsKey(examCode));
  } catch {
    // 消せなくても、次の取得で重複が除かれる
  }
}

/** 利用者の設定 */
export const SettingsSchema = z.strictObject({ shuffleChoices: z.boolean() });
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = { shuffleChoices: false };

export function loadSettings(store: KeyValueStore): Settings {
  return readJson(store, `${KEY_PREFIX}:settings`, SettingsSchema) ?? DEFAULT_SETTINGS;
}

export function saveSettings(store: KeyValueStore, settings: Settings): boolean {
  return writeJson(store, `${KEY_PREFIX}:settings`, settings);
}

/** 段階の確認問題を採点した記録 */
const StageCheckSchema = z.strictObject({
  unitId: UNIT_ID,
  order: STAGE_ORDER,
  percent: z.number().min(0).max(100),
  passed: z.boolean(),
  finishedAt: STAMP,
});
export type StageCheck = z.infer<typeof StageCheckSchema>;

/** 段階学習の到達の状態(資格ごと)。端末の中だけに残る */
export const StageProgressSchema = z.strictObject({
  examCode: KEY,
  /** 単元の ID ごとの、合格した段階の順番(小さい順) */
  passed: z.record(UNIT_ID, z.array(STAGE_ORDER).max(100)).refine((p) => Object.keys(p).length <= 1000),
  /** 直近に採点した段階の確認(結果の画面で、合否を伝える) */
  last: StageCheckSchema.optional(),
});
export type StageProgress = z.infer<typeof StageProgressSchema>;

function stagesKey(examCode: string): string {
  return `${KEY_PREFIX}:stages:${examCode}`;
}

/** 段階の到達の状態を返す。保存されていない・壊れているときは、どの段階にも合格していない状態。 */
export function loadStageProgress(store: KeyValueStore, examCode: string): StageProgress {
  const progress = readJson(store, stagesKey(examCode), StageProgressSchema);
  return progress && progress.examCode === examCode ? progress : { examCode, passed: {} };
}

/** 単元の、合格した段階の順番 */
export function passedStages(progress: StageProgress, unitId: string): number[] {
  return Object.hasOwn(progress.passed, unitId) ? (progress.passed[unitId] ?? []) : [];
}

/** 段階の確認の採点を記録する。合格なら、その段階を合格済みにする(一度合格した段階は、不合格でも戻さない)。 */
export function saveStageCheck(store: KeyValueStore, examCode: string, check: StageCheck): boolean {
  const progress = loadStageProgress(store, examCode);
  const current = passedStages(progress, check.unitId);
  const orders =
    check.passed && !current.includes(check.order) ? [...current, check.order].sort((a, b) => a - b) : current;
  const next: StageProgress = { examCode, passed: { ...progress.passed, [check.unitId]: orders }, last: check };
  return writeJson(store, stagesKey(examCode), next);
}
