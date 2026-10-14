import { z } from "zod";
import { LEGACY_EXAM_CODES } from "./legacy-exam-codes.ts";

// ブラウザの localStorage に保存する学習の状態。端末の中だけに残る。
// 読み出した値は外部の入力として扱い、形を検査する。壊れていたら、保存されていないものとして扱う。

/** localStorage と同じ形の、最小の保存先。テストで差し替えられるようにする。 */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY_PREFIX = "mokumoku:v1";

/** 資格ごとに持つ記録の種類。持ち主(ログインしているアカウント)ごとに分ける */
const PER_EXAM_KINDS = ["session", "results", "stages", "sections", "conditions"] as const;

/**
 * 資格ごとの記録の、持ち主の印を付ける前のキー(`mokumoku:v1:<種類>:<試験コード>`)。
 * 各関数はこの形のキーで読み書きし、`ownedStore` が、端末に置くキー(`mokumoku:v1:<持ち主の印>:<種類>:<試験コード>`)に変える。
 */
const PER_EXAM_KEY = new RegExp(`^${KEY_PREFIX}:(?:${PER_EXAM_KINDS.join("|")}):`);

/** 持ち主の印の形(`sub` の SHA-256 の先頭 16 文字。`lib/owner-tag.ts`) */
const OWNER_PATTERN = /^[0-9a-f]{16}$/;

/**
 * いまの持ち主の印。セッションの API(`GET /api/auth/session`)の応答から、SessionProvider が渡す。端末には保存しない。
 * undefined は、まだ取れていない間(セッションの読み込み中)。null は、持ち主がいない・印が取れないとき(未ログイン・接続の失敗)。
 * 印は、端末の記録を持ち主ごとに分けるためだけに使い、認可の判断には使わない。
 */
let owner: string | null | undefined;
const ownerListeners = new Set<() => void>();

/** 持ち主の印を変える。形の合わない値は、印が取れないもの(null)として扱う。undefined は、読み込み中に戻す */
export function setStorageOwner(next: string | null | undefined): void {
  const value = typeof next === "string" && !OWNER_PATTERN.test(next) ? null : next;
  if (value === owner) return;
  owner = value;
  for (const listener of ownerListeners) listener();
}

export function storageOwner(): string | null | undefined {
  return owner;
}

/** 持ち主の印が変わったときに呼ぶ関数を登録する。戻り値で登録を外す */
export function subscribeStorageOwner(listener: () => void): () => void {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

/**
 * 持ち主の照合をした保存先。資格ごとの記録だけ、キーに持ち主の印を入れて読み書きする(ほかのアカウントの記録は、キーが違うので読まない)。
 * 印がないとき(読み込み中・取れないとき)は、資格ごとの記録を読まず(null)、書かず(例外)、消さない。
 * 表示の設定など、資格ごとの記録でないキーは、そのまま扱う。
 */
export function ownedStore(base: KeyValueStore, tag: string | null | undefined): KeyValueStore {
  const resolve = (key: string): string | null => {
    if (!PER_EXAM_KEY.test(key)) return key;
    return tag ? `${KEY_PREFIX}:${tag}:${key.slice(KEY_PREFIX.length + 1)}` : null;
  };
  return {
    getItem: (key) => {
      const resolved = resolve(key);
      return resolved === null ? null : base.getItem(resolved);
    },
    setItem: (key, value) => {
      const resolved = resolve(key);
      if (resolved === null) throw new Error("持ち主が分からないため、保存しません。");
      base.setItem(resolved, value);
    },
    removeItem: (key) => {
      const resolved = resolve(key);
      if (resolved !== null) base.removeItem(resolved);
    },
  };
}

/** 持ち主の印のない、資格ごとの記録(`mokumoku:v1:<種類>:<試験コード>`)を、読まずに消す */
export function removeUnownedRecords(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && PER_EXAM_KEY.test(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/**
 * ブラウザの localStorage を、いまの持ち主の照合を付けて返す(`ownedStore`)。
 * 保存が禁止されていると、`window.localStorage` を参照した時点で例外になる。
 * 参照を各メソッドの中で行い、この例外を、保存の処理の try で受けられるようにする。
 */
export function browserStore(): KeyValueStore {
  const local: KeyValueStore = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  };
  // 持ち主の印のない記録を、このページの読み込みで 1 回だけ、読まずに消す
  if (!unownedRemoved && typeof window !== "undefined") {
    unownedRemoved = true;
    try {
      removeUnownedRecords(window.localStorage);
    } catch {
      // 保存が禁止されているときなど。消せなくても、印のない記録は読まないので、画面は動く
    }
  }
  const store = ownedStore(local, owner);
  // 以前の試験コードで保存した記録を、持ち主ごとに、このページの読み込みで 1 回だけ、新しいコードへ移す
  if (owner && !legacyKeysChecked.has(owner) && typeof window !== "undefined") {
    legacyKeysChecked.add(owner);
    try {
      migrateLegacyExamKeys(store, LEGACY_EXAM_CODES);
    } catch {
      // 保存が禁止されているときなど。移せなくても、画面は動く
    }
  }
  return store;
}

let unownedRemoved = false;
const legacyKeysChecked = new Set<string>();

/** 値の中の `examCode` を、旧コードから新しいコードに置き換える(入れ子の中も) */
function replaceExamCode(value: unknown, from: string, to: string): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceExamCode(item, from, to));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "examCode" && item === from ? to : replaceExamCode(item, from, to),
      ]),
    );
  }
  return value;
}

/**
 * 以前の試験コードのキーで保存した記録を、新しい試験コードのキーへ移す。値の中の `examCode` も新しいコードにする。
 * 新しいコードのキーにすでに記録があるときは、それを残し、以前のキーだけを消す。値が読めないときは、以前のキーを消さない。
 * 持ち主の照合をした保存先(`ownedStore`)に使い、同じ持ち主の記録の中で移す。
 */
export function migrateLegacyExamKeys(store: KeyValueStore, legacy: Readonly<Record<string, string>>): void {
  for (const [from, to] of Object.entries(legacy)) {
    for (const kind of PER_EXAM_KINDS) {
      const oldKey = `${KEY_PREFIX}:${kind}:${from}`;
      const raw = store.getItem(oldKey);
      if (raw === null) continue;
      const newKey = `${KEY_PREFIX}:${kind}:${to}`;
      if (store.getItem(newKey) === null) {
        let moved: string;
        try {
          moved = JSON.stringify(replaceExamCode(JSON.parse(raw), from, to));
        } catch {
          continue;
        }
        store.setItem(newKey, moved);
      }
      store.removeItem(oldKey);
    }
  }
}

/**
 * この端末に結果を残す件数(資格ごと、新しい順)。localStorage の容量(多くのブラウザで 5MB 程度)に収まるよう、上限を置く。
 * アカウントには、件数の上限なしで残す(docs/app/data.md)。
 */
export const MAX_RESULTS = 50;

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

/** 1 問の回答時間の上限(ミリ秒)。これより長い値は、壊れた値として扱う */
export const MAX_ANSWER_TIME_MS = 24 * 60 * 60 * 1000;

/** 問題ごとの記録(出題した問題の並びと同じ長さの配列)。回答時間・自信なし・見直し */
const TimesSchema = z.array(z.int().min(0).max(MAX_ANSWER_TIME_MS)).max(1000).optional();
const MarksSchema = z.array(z.boolean()).max(1000).optional();

/** 問題ごとの記録の項目。どれも任意で、持つときは、出題した問題の数と同じ長さにする */
export const PER_QUESTION_FIELDS = ["timesMs", "unsure", "flagged"] as const;

/** 問題ごとの記録の配列が、出題した問題の数と同じ長さか。違えば、その項目を指摘する */
export function checkPerQuestionLengths(
  value: { questionIds: readonly string[] } & Partial<Record<string, unknown>>,
  ctx: z.RefinementCtx,
  fields: readonly string[] = PER_QUESTION_FIELDS,
): void {
  for (const field of fields) {
    const list = value[field];
    if (Array.isArray(list) && list.length !== value.questionIds.length) {
      ctx.addIssue({ code: "custom", path: [field], message: "問題の数と合いません。" });
    }
  }
}

/** 解答の表示のしかた。end はまとめて最後に(既定)、each は 1 問ごと */
export const REVEAL_CHOICES = ["end", "each"] as const;
export type Reveal = (typeof REVEAL_CHOICES)[number];

/** 出題中の状態(途中で閉じても続きから解ける) */
export const SessionSchema = z
  .strictObject({
    examCode: KEY,
    questionIds: z.array(KEY).min(1).max(1000),
    answers: AnswersSchema,
    textAnswers: TextAnswersSchema,
    index: z.number().int().min(0).max(1000),
    startedAt: STAMP,
    choiceOrder: ChoiceOrderSchema,
    /** 段階の確認問題として始めた出題のときだけ。採点すると、その段階の到達の状態を更新する */
    stage: StageRefSchema.optional(),
    /** セクション(5 問ずつの区切り)の番号(0 始まり)。セクションの出題のときだけ。採点すると、その記録を更新する */
    section: z.int().min(0).max(999).optional(),
    /** 本番モードの締め切り(ISO 8601)。再読み込みしても残り時間を保つ。通常の出題では持たない */
    deadline: STAMP.optional(),
    /** 解答の表示のしかた。持たないときは、まとめて最後に */
    reveal: z.enum(REVEAL_CHOICES).optional(),
    /** 1 問ごとの表示で「回答する」を押した問題(押したあとは、選択を変えられない) */
    checked: MarksSchema,
    /** 問題ごとの回答時間(ミリ秒)。タブが隠れている間は数えない */
    timesMs: TimesSchema,
    /** 自信なしの印。正解しても、復習に残す */
    unsure: MarksSchema,
    /** 見直しの印。印だけで、採点には影響しない */
    flagged: MarksSchema,
  })
  .superRefine((session, ctx) => checkPerQuestionLengths(session, ctx, [...PER_QUESTION_FIELDS, "checked"]));
export type Session = z.infer<typeof SessionSchema>;

/** 採点した結果の項目(サーバーの検査は、これに条件を足す) */
export const ResultBaseSchema = z.strictObject({
  examCode: KEY,
  questionIds: z.array(KEY).min(1).max(1000),
  answers: AnswersSchema,
  textAnswers: TextAnswersSchema,
  finishedAt: STAMP,
  choiceOrder: ChoiceOrderSchema,
  /** 問題ごとの回答時間・自信なし・見直し。古い結果は持たない */
  timesMs: TimesSchema,
  unsure: MarksSchema,
  flagged: MarksSchema,
});

/** 採点した結果 */
export const ResultSchema = ResultBaseSchema.superRefine((result, ctx) => checkPerQuestionLengths(result, ctx));
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

/** 利用者の設定。解答の表示のしかたは、次の出題の既定になる */
export const SettingsSchema = z.strictObject({
  shuffleChoices: z.boolean(),
  reveal: z.enum(REVEAL_CHOICES).optional(),
});
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

/** セクションの記録(セクションの番号ごとの、いちばん良い正答数)。端末の中と、サーバー(ログイン中)に残る */
const SectionRecordSchema = z.strictObject({
  correct: z.int().min(0).max(1000),
  total: z.int().min(1).max(1000),
  finishedAt: STAMP,
});
export type SectionRecord = z.infer<typeof SectionRecordSchema>;

export const SectionProgressSchema = z.strictObject({
  examCode: KEY,
  /** セクションの番号(文字列)ごとの、いちばん良い記録 */
  best: z.record(z.string().regex(/^\d{1,3}$/), SectionRecordSchema).refine((b) => Object.keys(b).length <= 1000),
  /** 直近に採点したセクション(結果の画面で、合否と次のセクションを出す) */
  last: SectionRecordSchema.extend({ section: z.int().min(0).max(999) }).optional(),
});
export type SectionProgress = z.infer<typeof SectionProgressSchema>;

function sectionsKey(examCode: string): string {
  return `${KEY_PREFIX}:sections:${examCode}`;
}

export function loadSectionProgress(store: KeyValueStore, examCode: string): SectionProgress {
  const progress = readJson(store, sectionsKey(examCode), SectionProgressSchema);
  return progress && progress.examCode === examCode ? progress : { examCode, best: {} };
}

/** セクションの採点を記録する。いちばん良い記録(正答数の多いもの)を残し、直近の記録は上書きする */
export function saveSectionCheck(
  store: KeyValueStore,
  examCode: string,
  section: number,
  record: SectionRecord,
): boolean {
  const progress = loadSectionProgress(store, examCode);
  const key = String(section);
  const before = Object.hasOwn(progress.best, key) ? progress.best[key] : undefined;
  const best = before && before.correct >= record.correct ? before : record;
  const next: SectionProgress = { examCode, best: { ...progress.best, [key]: best }, last: { ...record, section } };
  return writeJson(store, sectionsKey(examCode), next);
}

/**
 * 2 つの進捗を 1 つにする(端末の進捗とサーバーの進捗、別の端末で採点した進捗)。
 * セクションごとに、正答数の多いほうを残し(同じなら base)、直近は、完了時刻の新しいほうを残す。
 */
export function mergeSectionProgress(base: SectionProgress, incoming: SectionProgress): SectionProgress {
  const best: SectionProgress["best"] = { ...base.best };
  for (const [key, record] of Object.entries(incoming.best)) {
    const before = Object.hasOwn(best, key) ? best[key] : undefined;
    if (!before || record.correct > before.correct) best[key] = record;
  }
  const last =
    base.last && incoming.last
      ? incoming.last.finishedAt > base.last.finishedAt
        ? incoming.last
        : base.last
      : (base.last ?? incoming.last);
  return { examCode: base.examCode, best, ...(last ? { last } : {}) };
}

/** 進捗を、そのまま端末に保存する(サーバーの進捗を取り込んだあとに使う) */
export function saveSectionProgress(store: KeyValueStore, progress: SectionProgress): boolean {
  return writeJson(store, sectionsKey(progress.examCode), progress);
}

/** 出題の条件(モード選択で選んだもの)。資格ごとに、この端末にだけ保存し、次回の初期値にする */
export const ConditionsSchema = z.strictObject({
  target: z.enum(["all", "review", "bookmarks"]),
  domains: z.array(z.string().max(32)).max(50),
  difficulties: z.array(z.enum(["easy", "medium", "hard"])).max(3),
  count: z.int().min(1).max(1000),
  preferFewer: z.boolean(),
  reveal: z.enum(REVEAL_CHOICES),
});
export type Conditions = z.infer<typeof ConditionsSchema>;

function conditionsKey(examCode: string): string {
  return `${KEY_PREFIX}:conditions:${examCode}`;
}

export function loadConditions(store: KeyValueStore, examCode: string): Conditions | null {
  return readJson(store, conditionsKey(examCode), ConditionsSchema);
}

export function saveConditions(store: KeyValueStore, examCode: string, conditions: Conditions): boolean {
  return writeJson(store, conditionsKey(examCode), conditions);
}
