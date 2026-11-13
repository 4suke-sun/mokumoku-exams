/**
 * 引っかかりの受け箱(JSONL)。作業中に起きた手戻りを 1 件ずつ足し、同じ種類のキーが繰り返された分を Issue の候補にする。
 * 置き場は `.git` の共有領域(scripts/lib/inspection-ledger.ts の台帳と同じ)なので、作業ツリーをまたいで合算できる。
 * 純粋な関数だけを置く(読み書きと CLI は scripts/lessons.ts)。
 */
import { join } from "node:path";
import type { ManifestEntry } from "./issue-manifest.ts";

/** 誰の問題か */
export const WHOS = ["main", "subagent", "human", "system"] as const;
/** 原因の分類: 知識がなかった / 知っていたが守らなかった / 指示が曖昧だった / 確認しなかった */
export const CAUSES = ["knowledge", "ignored", "ambiguous", "unchecked"] as const;
/** 昇格先の候補(強い順)。docs/lessons-workflow.md の「昇格先」 */
export const PROMOTIONS = ["mechanical", "rules", "skill", "lessons", "claude-md"] as const;

export type Who = (typeof WHOS)[number];
export type Cause = (typeof CAUSES)[number];
export type Promotion = (typeof PROMOTIONS)[number];

/** 1 件の引っかかり。入力の値(認証情報など)は書かない。何が起きたかの種類と、本来どうすべきかだけを書く。 */
export interface Candidate {
  type: "candidate";
  at: string;
  /** 版(ブランチ名の末尾の `vX.Y.Z`)。分からないときは `unknown` */
  version: string;
  /** 同じ原因なら同じになる短い名前。件数を数える単位 */
  key: string;
  who: Who;
  cause: Cause;
  what: string;
  should: string;
  promote: Promotion;
}

/** 種類のキーを、Issue 化または対処済みにした印。これより前の件数は数えない。 */
export interface ClosedMark {
  type: "closed";
  at: string;
  key: string;
  /** 対処の行き先(Issue の番号、ルールの名前など) */
  ref: string;
}

export type InboxRecord = Candidate | ClosedMark;

/** 版の形。ブランチ名から取れなければ `unknown`。 */
export const VERSION_PATTERN = /^(v\d+\.\d+\.\d+|unknown)$/;
export const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const TEXT_MAX = 200;
/** 繰り返しとみなす件数の初期値 */
export const DEFAULT_THRESHOLD = 2;

const INBOX_FILE = "mokumoku-lessons-inbox.jsonl";

export function inboxPath(gitCommonDir: string): string {
  return join(gitCommonDir, INBOX_FILE);
}

/** ブランチ名の末尾の版(`feat/#315-v0.45.0` → `v0.45.0`)。なければ `unknown`。 */
export function versionOfBranch(branch: string): string {
  return /-(v\d+\.\d+\.\d+)$/.exec(branch)?.[1] ?? "unknown";
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

/** 本文として書ける文字列か(空でなく、200 文字まで、1 行)。受け箱への書き込みと読み込みの両方で使う。 */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= TEXT_MAX && !value.includes("\n");
}

function toRecord(value: unknown): InboxRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.at !== "string" || typeof r.key !== "string" || !KEY_PATTERN.test(r.key)) return null;
  if (r.type === "closed" && isText(r.ref)) return { type: "closed", at: r.at, key: r.key, ref: r.ref };
  if (
    r.type === "candidate" &&
    typeof r.version === "string" &&
    VERSION_PATTERN.test(r.version) &&
    isOneOf(WHOS, r.who) &&
    isOneOf(CAUSES, r.cause) &&
    isOneOf(PROMOTIONS, r.promote) &&
    isText(r.what) &&
    isText(r.should)
  ) {
    return {
      type: "candidate",
      at: r.at,
      version: r.version,
      key: r.key,
      who: r.who,
      cause: r.cause,
      what: r.what,
      should: r.should,
      promote: r.promote,
    };
  }
  return null;
}

/** 受け箱を読む。壊れた行・形の合わない行は飛ばす(エラーの文言は出さない)。 */
export function parseInbox(text: string): InboxRecord[] {
  const records: InboxRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const record = toRecord(JSON.parse(line));
      if (record) records.push(record);
    } catch {
      // 壊れた行は読まない
    }
  }
  return records;
}

/** 1 件を 1 行にする。読み込み(parseInbox)と同じ検査に通らない記録は、書かずに例外にする(書けたのに読めない行を作らない)。 */
export function serializeRecord(record: InboxRecord): string {
  if (toRecord(record) === null) throw new Error("受け箱の記録の形が合わない");
  return `${JSON.stringify(record)}\n`;
}

/** 入力を検査して 1 件にする。足りない・不正な項目があれば、項目の名前だけを返す(値は返さない)。 */
export function buildCandidate(
  input: Partial<Record<"key" | "who" | "cause" | "promote" | "what" | "should", string | undefined>>,
  context: { at: string; version: string },
): { ok: true; candidate: Candidate } | { ok: false; invalid: string[] } {
  const invalid: string[] = [];
  const { key, who, cause, promote, what, should } = input;
  if (key === undefined || !KEY_PATTERN.test(key)) invalid.push("key");
  if (!isOneOf(WHOS, who)) invalid.push("who");
  if (!isOneOf(CAUSES, cause)) invalid.push("cause");
  if (!isOneOf(PROMOTIONS, promote)) invalid.push("promote");
  if (!isText(what)) invalid.push("what");
  if (!isText(should)) invalid.push("should");
  if (invalid.length > 0 || key === undefined || !isOneOf(WHOS, who) || !isOneOf(CAUSES, cause)) {
    return { ok: false, invalid };
  }
  if (!isOneOf(PROMOTIONS, promote) || !isText(what) || !isText(should)) return { ok: false, invalid };
  return {
    ok: true,
    candidate: { type: "candidate", ...context, key, who, cause, what, should, promote },
  };
}

/** 種類のキーごとの、まだ対処していない件(最後の「対処済み」の印より後)。 */
export function openByKey(records: InboxRecord[]): Map<string, Candidate[]> {
  const byKey = new Map<string, Candidate[]>();
  for (const record of records) {
    if (record.type === "closed") {
      byKey.delete(record.key);
    } else {
      byKey.set(record.key, [...(byKey.get(record.key) ?? []), record]);
    }
  }
  return byKey;
}

export interface Repeat {
  key: string;
  count: number;
  /** 件数のうち、別々の版にまたがる数 */
  versions: number;
  entries: Candidate[];
}

/** しきい値以上の件数になった種類。件数の多い順。 */
export function findRepeats(records: InboxRecord[], threshold = DEFAULT_THRESHOLD): Repeat[] {
  const repeats: Repeat[] = [];
  for (const [key, entries] of openByKey(records)) {
    if (entries.length < threshold) continue;
    repeats.push({ key, count: entries.length, versions: new Set(entries.map((e) => e.version)).size, entries });
  }
  return repeats.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** 昇格先は、強い方を採る(PROMOTIONS の並びの先頭に近い方)。 */
export function strongestPromotion(entries: Candidate[]): Promotion {
  return entries.map((e) => e.promote).sort((a, b) => PROMOTIONS.indexOf(a) - PROMOTIONS.indexOf(b))[0] ?? "lessons";
}

const PROMOTION_LABEL: Record<Promotion, string> = {
  mechanical: "機械検査・テスト・フック",
  rules: "チェックリストと役ごとの共通の決まり、エージェントの定義",
  skill: "スキルの手順",
  lessons: "docs/app/lessons/",
  "claude-md": "CLAUDE.md",
};

const CAUSE_LABEL: Record<Cause, string> = {
  knowledge: "知識がなかった",
  ignored: "知っていたが守らなかった",
  ambiguous: "指示が曖昧だった",
  unchecked: "確認しなかった",
};

const WHO_LABEL: Record<Who, string> = {
  main: "メインのセッション",
  subagent: "サブエージェント",
  human: "人の指示",
  system: "仕組み",
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/**
 * 繰り返しの種類から、Issue の下書き(1 行目が `# 題`、2 行目が空行、3 行目以降が本文)を作る。
 * 版の番号の行は書かない(版はマイルストーンで持つ)。件数は数だけを書く。
 */
export function formatIssueDraft(repeat: Repeat): string {
  const { key, count, versions, entries } = repeat;
  const promote = strongestPromotion(entries);
  const lines = [
    `# chore: 繰り返し起きた引っかかり(${key})の再発を止める`,
    "",
    "## 目的",
    "",
    `作業中の同じ種類の引っかかりが、受け箱に ${count} 件記録された(${versions} つの版にまたがる)。`,
    "一度きりの偶発ではなく、仕組みの問題として扱う。",
    "",
    "起きたこと(記録された内容):",
    "",
    ...unique(entries.map((e) => e.what)).map((w) => `- ${w}`),
    "",
    `誰の問題か: ${unique(entries.map((e) => WHO_LABEL[e.who])).join("、")}`,
    `原因の分類: ${unique(entries.map((e) => CAUSE_LABEL[e.cause])).join("、")}`,
    "",
    "## 作業",
    "",
    "本来どうすべきだったか(記録された内容):",
    "",
    ...unique(entries.map((e) => e.should)).map((s) => `- ${s}`),
    "",
    `- 再発を止める形に昇格する。昇格先の第一候補は「${PROMOTION_LABEL[promote]}」。強い順に、機械で止められるかを先に検討する。`,
    "- 昇格したら、受け箱の種類に対処済みの印を付ける(`node scripts/lessons.ts close`)。",
    "",
    "## 完了条件",
    "",
    "- 同じ種類の引っかかりが、昇格先で止まる(テストまたは手順の確認がある)。",
    "- lint / build / test が通る。",
    "- 環境固有の値・個人情報が差分にない。",
    "",
  ];
  return lines.join("\n");
}

/** 受け箱から起票する Issue に付けるラベル。決まりは docs/lessons-workflow.md の「繰り返しと Issue の候補」。 */
export const LESSONS_LABEL = "lessons";

/** 繰り返しの種類の下書きのファイル名(`.drafts/issues/` の下)。 */
export function draftFileName(key: string): string {
  return `lessons-${key}.md`;
}

/**
 * Issue の下書きの一覧(`.drafts/issues/manifest.json`)に、作った下書きの項目(新規、ラベル `lessons`)を足す。
 * 一覧にすでに同じ `file` の項目があるときは、足さず、書き換えない(人が直したラベルやマイルストーン、投稿の結果を守る)。
 * マイルストーンは付けない。起票の場で決める(版が決まっていない新規の Issue は、一覧の検査で、マイルストーンかラベル `later` を求められる)。
 * 一覧が配列でないときは null(足さない)。
 */
export function addDraftEntries(
  manifest: unknown,
  files: string[],
): { entries: unknown[]; added: string[]; skipped: string[] } | null {
  if (!Array.isArray(manifest)) return null;
  const present = new Set<unknown>(manifest.map((entry) => (entry as { file?: unknown } | null)?.file));
  const added = files.filter((file) => !present.has(file));
  const skipped = files.filter((file) => present.has(file));
  const fresh: ManifestEntry[] = added.map((file) => ({ action: "create", file, labels: [LESSONS_LABEL] }));
  return { entries: [...manifest, ...fresh], added, skipped };
}

/** 対処済みにした記録(キー・行き先・日付)。記録した順。対処していないキーは含まない。 */
export function closedMarks(records: InboxRecord[]): { key: string; ref: string; date: string }[] {
  return records.flatMap((record) =>
    record.type === "closed" ? [{ key: record.key, ref: record.ref, date: record.at.slice(0, 10) }] : [],
  );
}

/** 受け箱の集計(原因・誰の問題か・昇格先ごとの件数)。計測に使う。 */
export function summarize(records: InboxRecord[]): Record<"who" | "cause" | "promote", Record<string, number>> {
  const out = { who: {}, cause: {}, promote: {} } as Record<"who" | "cause" | "promote", Record<string, number>>;
  for (const record of records) {
    if (record.type !== "candidate") continue;
    for (const field of ["who", "cause", "promote"] as const) {
      out[field][record[field]] = (out[field][record[field]] ?? 0) + 1;
    }
  }
  return out;
}
