import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EXAM_CODE, ReferenceTitle, sourceUrlReason } from "../contract.ts";
import { AgentStampSchema } from "../shared/agents.ts";
import { PathsError } from "../shared/errors.ts";
import { writeFileAtomic } from "../shared/fs.ts";
import { withinParaphraseLimit, withinQuoteLimit, withinQuotesTotal } from "./text-limits.ts";

/**
 * 出典の台帳(ADR 0006)。資格ごとに 1 つの JSON をコミットする。
 * 持つのはリンク、公式ページの題、取得の記録、本文のハッシュ、短い言い換えだけで、本文は持たない。
 */

export const SOURCE_KINDS = ["exam-guide", "official-doc", "standard"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
/** active だけが、先の段階の根拠に使える。ほかは止める */
export const SOURCE_STATUSES = ["active", "needs-review", "deprecated", "unreachable"] as const;
export const CHECK_NAMES = ["official", "target", "deprecation", "freshness", "liveness"] as const;
export const CHECK_RESULTS = ["pass", "fail", "unknown"] as const;

export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type CheckName = (typeof CHECK_NAMES)[number];
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const ID = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
export const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);
/** 理由コード。小文字とハイフンだけにして、値や本文が入らないようにする */
export const REASON = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

export const SourceUrl = z
  .string()
  .max(2000)
  .refine((value) => sourceUrlReason(value) === null, "出典に使えない URL");

/** 対象のリージョンの表記(us-east-1 など) */
export const REGION = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const Paraphrase = z.string().min(1).refine(withinParaphraseLimit, "言い換えが長すぎる");

/**
 * 試験ガイドの対象サービスの名前 1 件。本文の引用ではなく、サービス名という事実として持つ(docs/source-policy.md)。
 * 名前のほかの文が入らないよう、長さと文字を絞る
 */
export const ServiceName = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 .&()/+'-]*$/);

/** 対象サービスの一覧の件数の上限 */
export const MAX_SERVICES = 300;

const ClaimSchema = z.strictObject({
  id: ID,
  /** 根拠にした主張の言い換え(自分の言葉の短い文) */
  paraphrase: Paraphrase,
  /** 表記を正しく示すための短い引用 */
  quotes: z.array(z.string().min(1).refine(withinQuoteLimit, "引用が長すぎる")).max(5).refine(withinQuotesTotal),
  /** この主張を確かめた事実カードの ID */
  factRefs: z.array(ID).max(50),
});

const CheckRecordSchema = z.strictObject({
  name: z.enum(CHECK_NAMES),
  result: z.enum(CHECK_RESULTS),
  reason: REASON.optional(),
});

export const SourceEntrySchema = z.strictObject({
  url: SourceUrl,
  kind: z.enum(SOURCE_KINDS),
  target: z.strictObject({
    examCode: z.string().regex(EXAM_CODE),
    edition: z.string().min(1).max(16).optional(),
    region: REGION.optional(),
  }),
  /**
   * 公式ページの題(`<title>`)。書き出しで、問題の出典の題に使う。本文ではなく短い文字列で、データの契約の出典の題と同じ規則
   * (URL を含まない、200 文字以内)。取得できなかった出典、古い記録にはない
   */
  title: ReferenceTitle.optional(),
  /** 最後に取得を試みた日。まだ一度も取得していなければ null */
  fetchedAt: ISO_DATE.nullable(),
  /** 最後に取得できた本文のハッシュ(sha256)。取得できていなければ null */
  contentHash: SHA256.nullable(),
  /** 出典が示す更新日。取れなければ null */
  updatedAt: ISO_DATE.nullable(),
  status: z.enum(SOURCE_STATUSES),
  checks: z.array(CheckRecordSchema).max(CHECK_NAMES.length),
  claims: z.array(ClaimSchema).max(200),
});

const GuideDomainSchema = z.strictObject({
  /** 資格マスタの分野のコード(domain1 など) */
  code: z.string().regex(/^domain[1-9][0-9]?$/),
  name: Paraphrase,
  /** 配点の割合(0〜1) */
  weight: z.number().min(0).max(1),
  /** 出題範囲の言い換え */
  scope: z.array(Paraphrase).max(40),
});

/** 試験ガイドから取り込んだ、分野・配点・出題範囲・本番の値・対象サービスの一覧 */
export const GuideRecordSchema = z.strictObject({
  sourceUrl: SourceUrl,
  contentHash: SHA256,
  /** 抽出の材料にした、試験ガイドの続きのページ(計画の guidePages)と、その本文のハッシュ */
  pages: z
    .array(z.strictObject({ url: SourceUrl, contentHash: SHA256 }))
    .max(20)
    .default([]),
  importedAt: ISO_DATE,
  /** 試験ガイドが示した本番の値(数値だけ。ガイドが示さない項目は持たない) */
  exam: z
    .strictObject({
      questionCount: z.number().int().positive().optional(),
      scoredQuestionCount: z.number().int().positive().optional(),
      timeMinutes: z.number().int().positive().optional(),
      passingScore: z.number().int().positive().optional(),
      totalScore: z.number().int().positive().optional(),
    })
    .optional(),
  /** 抽出に使ったエージェントの定義(役・モデルの ID・定義のハッシュ。古い記録にはない) */
  agent: AgentStampSchema.optional(),
  /** 試験ガイドの対象サービスの一覧(サービスの名前だけ)。ガイドが示さないとき、古い記録にはない */
  services: z.array(ServiceName).max(MAX_SERVICES).optional(),
  domains: z.array(GuideDomainSchema).min(1).max(20),
});

export const LedgerFileSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  sources: z.array(SourceEntrySchema),
  guide: GuideRecordSchema.nullable(),
  /** 出典の変化で、再検証が要るとされたもの。済むまで先の段階へ進めない */
  recheck: z.strictObject({
    facts: z.array(ID),
    questions: z.array(z.string().min(1).max(64)),
  }),
});

export type SourceEntry = z.infer<typeof SourceEntrySchema>;
export type GuideRecord = z.infer<typeof GuideRecordSchema>;
export type LedgerFile = z.infer<typeof LedgerFileSchema>;

/** 台帳の検査の誤り。場所(項目のパス)だけを持ち、値は持たない */
export class LedgerError extends PathsError {
  constructor(paths: string[]) {
    super("台帳の誤り", paths);
  }
}

export function emptyLedger(examCode: string): LedgerFile {
  return { examCode, sources: [], guide: null, recheck: { facts: [], questions: [] } };
}

export function ledgerPath(ledgerDir: string, examCode: string): string {
  return join(ledgerDir, `${examCode.toLowerCase()}.json`);
}

export function parseLedger(raw: unknown): LedgerFile {
  const parsed = LedgerFileSchema.safeParse(raw);
  if (!parsed.success) throw new LedgerError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const urls = parsed.data.sources.map((s) => s.url);
  const dup = urls.findIndex((u, i) => urls.indexOf(u) !== i);
  if (dup >= 0) throw new LedgerError([`sources.${dup}.url`]);
  return parsed.data;
}

/** 並びを固定する。出典は URL 順、主張は ID 順、検査は CHECK_NAMES の順、再検証の一覧は昇順で重複なし */
export function normalizeLedger(ledger: LedgerFile): LedgerFile {
  const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    ...ledger,
    sources: [...ledger.sources]
      .sort((a, b) => byString(a.url, b.url))
      .map((s) => ({
        ...s,
        checks: [...s.checks].sort((a, b) => CHECK_NAMES.indexOf(a.name) - CHECK_NAMES.indexOf(b.name)),
        claims: [...s.claims]
          .sort((a, b) => byString(a.id, b.id))
          .map((c) => ({ ...c, factRefs: [...new Set(c.factRefs)].sort(byString) })),
      })),
    recheck: {
      facts: [...new Set(ledger.recheck.facts)].sort(byString),
      questions: [...new Set(ledger.recheck.questions)].sort(byString),
    },
  };
}

/** キーを辞書順に並べ直す(書き出しの差分を安定させる) */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** 検査してから、キーの順序・並び・改行を固定した文字列にする */
export function serializeLedger(ledger: LedgerFile): string {
  const checked = parseLedger(normalizeLedger(ledger));
  return `${JSON.stringify(sortKeys(checked), null, 2)}\n`;
}

/** 台帳を読む。ファイルがなければ空の台帳 */
export function readLedger(path: string, examCode: string): LedgerFile {
  if (!existsSync(path)) return emptyLedger(examCode);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new LedgerError(["(JSON の形)"]);
  }
  const ledger = parseLedger(raw);
  if (ledger.examCode !== examCode) throw new LedgerError(["examCode"]);
  return ledger;
}

/** 台帳を書く。一時ファイルに書いてから置き換えるので、途中で止まっても壊れたファイルを残さない */
export function writeLedger(path: string, ledger: LedgerFile): void {
  const text = serializeLedger(ledger);
  writeFileAtomic(path, text);
}

/** 先の段階の根拠に使える出典(状態が active のもの)だけを返す */
export function usableSources(ledger: LedgerFile): SourceEntry[] {
  return ledger.sources.filter((s) => s.status === "active");
}
