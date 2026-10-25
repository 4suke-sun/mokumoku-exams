import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EXAM_CODE } from "../contract.ts";
import { DIFFICULTIES } from "../plan/schema.ts";
import { AgentStampSchema } from "../shared/agents.ts";
import { PathsError } from "../shared/errors.ts";
import { writeFileAtomic, writeJson } from "../shared/fs.ts";
import { VerificationSchema } from "../verify/schema.ts";
import { DRAFT_ID, DraftSchema, FACT_ID } from "./schema.ts";

/**
 * 下書きの置き場(作業用の置き場。コミットしない)。
 * 通った下書きの本文は持つが、不採用の下書きは本文を持たない(ID と理由コードだけ。人の却下と、直して置き換えた下書きは、根拠の事実カードの ID も残す)。
 */

export const DRAFT_STATUSES = ["passed", "held", "rejected"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** 理由コード: `style:<規則の名前>` か、固定の語 */
const REASON = z.string().regex(/^[a-z0-9]+(?:[:-][a-z0-9]+)*$/);

export const DraftRecordSchema = z.strictObject({
  id: DRAFT_ID,
  planItemId: z.string().regex(/^p-[0-9a-f]{12}$/),
  domain: z.string().regex(/^domain[1-9][0-9]?$/),
  difficulty: z.enum(DIFFICULTIES),
  status: z.enum(DRAFT_STATUSES),
  /** 保留・不採用の理由コード */
  reasons: z.array(REASON).max(40),
  /** 警告の規則の名前と場所(本文は含まない) */
  warnings: z.array(z.strictObject({ rule: REASON, path: z.string().max(60) })).max(80),
  /** 不採用のときは null */
  draft: DraftSchema.nullable(),
  /** この下書きを作ったエージェントの定義(役・モデルの ID・定義のハッシュ。古い記録にはない) */
  agent: AgentStampSchema.optional(),
  /** 設問文の、公開済みの問題やほかの下書きとの最大の類似度(0〜1、小数 2 桁)。人の確認の抜き取りで、保留に近いかを見る。古い記録にはない */
  similarity: z.number().min(0).max(1).optional(),
  /** 検証の段階の結果(検証前はない)。検証を通った合格は、verdict が pass のもの */
  verification: VerificationSchema.optional(),
  /** 直した下書き(ブラッシュアップ役の出力)のとき、直す前の下書きの ID */
  revisionOf: DRAFT_ID.optional(),
  /**
   * 本文を持たなくなった下書き(人の却下、直したことによる置き換え)の、根拠にした事実カードの ID。
   * 補充の依頼で、同じカードを使われていない扱いに戻さないため(ID だけで、本文は持たない)
   */
  factIds: z.array(FACT_ID).max(10).optional(),
});

export const DraftsFileSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  drafts: z.array(DraftRecordSchema),
});

export type DraftRecord = z.infer<typeof DraftRecordSchema>;
export type DraftsFile = z.infer<typeof DraftsFileSchema>;

/** 下書きの置き場の誤り。場所(項目のパス)だけを持ち、値は持たない */
export class DraftsError extends PathsError {
  constructor(paths: string[]) {
    super("下書きの誤り", paths);
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
  writeFileAtomic(path, text);
}

/** 計画の項目が満たせない理由。事実カードがない、項目の出し直しの上限、依頼の鍵の再試行の上限 */
export const UNMET_REASONS = ["no-facts", "max-rounds", "max-attempts"] as const;
export type UnmetReason = (typeof UNMET_REASONS)[number];

/**
 * 実行の状態。依頼の鍵ごとの失敗の回数、取り込み済みの鍵、計画の項目ごとの出し直しの回数、
 * 計画の項目ごとの未達の理由(理由コードの集合だけ。本文や入力値は持たない)
 */
export interface DraftState {
  attempts: Record<string, number>;
  done: string[];
  rounds: Record<string, number>;
  unmet: Record<string, UnmetReason[]>;
}

export function readState(path: string): DraftState {
  const empty: DraftState = { attempts: {}, done: [], rounds: {}, unmet: {} };
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
      unmet: reasons(raw.unmet),
    };
  } catch {
    return empty;
  }
}

/** 未達の理由を読む。知らない理由コードと、理由が空の項目は捨てる(古い形の状態は、空として読む) */
function reasons(value: unknown): Record<string, UnmetReason[]> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const known = new Set<string>(UNMET_REASONS);
  const entries = Object.entries(value).map(([id, v]): [string, UnmetReason[]] => [
    id,
    Array.isArray(v)
      ? [...new Set(v.filter((r): r is UnmetReason => typeof r === "string" && known.has(r)))].sort()
      : [],
  ]);
  return Object.fromEntries(entries.filter(([, v]) => v.length > 0));
}

export function writeState(path: string, state: DraftState): void {
  writeJson(path, { ...state, done: [...new Set(state.done)].sort() });
}

/** 人が却下した下書きの理由コード */
export const HUMAN_REJECTED = "human-rejected";

/** 直した下書きに置き換わった、直す前の下書きの理由コード */
export const REVISED = "revised";

/** 下書きの根拠にした事実カードの ID。本文を持たない下書きは、残した ID(なければ空) */
export function usedFactIds(record: DraftRecord): readonly string[] {
  return record.draft?.factIds ?? record.factIds ?? [];
}

/**
 * 人の判断を、下書きの状態に反映する。却下した下書きは不採用にし、本文を持たない(ほかの不採用と同じ)。
 * 根拠にした事実カードの ID だけは残し、補充の依頼で同じカードを先に選ばないようにする。
 * 保留の解除と承認は、保留の下書きを通過にする。
 */
export function applyDraftDecisions(
  file: DraftsFile,
  decisionOf: (id: string) => "approve" | "release" | "reject" | undefined,
): { file: DraftsFile; changed: number } {
  let changed = 0;
  const drafts = file.drafts.map((d): DraftRecord => {
    const decision = decisionOf(d.id);
    if (decision === "reject" && d.status !== "rejected") {
      changed++;
      const factIds = usedFactIds(d);
      return {
        ...d,
        status: "rejected",
        reasons: [HUMAN_REJECTED],
        draft: null,
        ...(factIds.length > 0 ? { factIds: [...factIds] } : {}),
      };
    }
    if ((decision === "release" || decision === "approve") && d.status === "held") {
      changed++;
      return { ...d, status: "passed", reasons: [] };
    }
    return d;
  });
  return { file: { ...file, drafts }, changed };
}
