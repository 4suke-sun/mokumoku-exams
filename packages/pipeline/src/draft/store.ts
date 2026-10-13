import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { EXAM_CODE } from "../contract.ts";
import { DIFFICULTIES } from "../plan/schema.ts";
import { ChoiceDraftSchema } from "./schema.ts";

/**
 * 下書きの置き場(作業用の置き場。コミットしない)。
 * 通った下書きの本文は持つが、不採用の下書きは本文を持たない(ID と理由コードだけ)。
 */

export const DRAFT_STATUSES = ["passed", "held", "rejected"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** 理由コード: `style:<規則の名前>` か、固定の語 */
const REASON = z.string().regex(/^[a-z0-9]+(?:[:-][a-z0-9]+)*$/);

export const DraftRecordSchema = z.strictObject({
  id: z.string().regex(/^d-[0-9a-f]{12}$/),
  planItemId: z.string().regex(/^p-[0-9a-f]{12}$/),
  domain: z.string().regex(/^domain[1-9][0-9]?$/),
  difficulty: z.enum(DIFFICULTIES),
  status: z.enum(DRAFT_STATUSES),
  /** 保留・不採用の理由コード */
  reasons: z.array(REASON).max(40),
  /** 警告の規則の名前と場所(本文は含まない) */
  warnings: z.array(z.strictObject({ rule: REASON, path: z.string().max(60) })).max(80),
  /** 不採用のときは null */
  draft: ChoiceDraftSchema.nullable(),
});

export const DraftsFileSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  drafts: z.array(DraftRecordSchema),
});

export type DraftRecord = z.infer<typeof DraftRecordSchema>;
export type DraftsFile = z.infer<typeof DraftsFileSchema>;

/** 下書きの置き場の誤り。場所(項目のパス)だけを持ち、値は持たない */
export class DraftsError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super("下書きの誤り");
    this.paths = paths;
  }
}

export function emptyDrafts(examCode: string): DraftsFile {
  return { examCode, drafts: [] };
}

export function draftWorkDir(workDir: string, examCode: string): string {
  return join(workDir, "draft", examCode.toLowerCase());
}

export function parseDrafts(raw: unknown): DraftsFile {
  const parsed = DraftsFileSchema.safeParse(raw);
  if (!parsed.success) throw new DraftsError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const ids = parsed.data.drafts.map((d) => d.id);
  const dup = ids.findIndex((id, i) => ids.indexOf(id) !== i);
  if (dup >= 0) throw new DraftsError([`drafts.${dup}.id`]);
  return parsed.data;
}

export function readDrafts(path: string, examCode: string): DraftsFile {
  if (!existsSync(path)) return emptyDrafts(examCode);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new DraftsError(["(JSON の形)"]);
  }
  const file = parseDrafts(raw);
  if (file.examCode !== examCode) throw new DraftsError(["examCode"]);
  return file;
}

/** 書く。ID 順に並べ、一時ファイルに書いてから置き換える */
export function writeDrafts(path: string, file: DraftsFile): void {
  const sorted = { ...file, drafts: [...file.drafts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  const text = `${JSON.stringify(parseDrafts(sorted), null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** 実行の状態。依頼の鍵ごとの失敗の回数、取り込み済みの鍵、計画の項目ごとの出し直しの回数 */
export interface DraftState {
  attempts: Record<string, number>;
  done: string[];
  rounds: Record<string, number>;
}

export function readState(path: string): DraftState {
  const empty: DraftState = { attempts: {}, done: [], rounds: {} };
  if (!existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<DraftState> | null;
    if (raw === null || typeof raw !== "object") return empty;
    const numbers = (value: unknown): Record<string, number> =>
      typeof value === "object" && value !== null
        ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === "number"))
        : {};
    return {
      attempts: numbers(raw.attempts),
      done: Array.isArray(raw.done) ? raw.done.filter((v): v is string => typeof v === "string") : [],
      rounds: numbers(raw.rounds),
    };
  } catch {
    return empty;
  }
}

export function writeState(path: string, state: DraftState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...state, done: [...new Set(state.done)].sort() }, null, 2)}\n`);
}
