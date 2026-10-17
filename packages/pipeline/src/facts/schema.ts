import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ID, Paraphrase, REASON, REGION, SHA256, SourceUrl } from "../collect/ledger.ts";
import { withinQuoteLimit } from "../collect/text-limits.ts";
import { EXAM_CODE } from "../contract.ts";
import { AgentStampSchema } from "../shared/agents.ts";
import { PathsError } from "../shared/errors.ts";
import { writeFileAtomic } from "../shared/fs.ts";

/**
 * 事実カード(ADR 0007・0008)。出典から取り出した主張を、1 件ずつ検査できる形で持つ。
 * 資格ごとに 1 つの JSON をコミットする。持つのはリンク、言い換えた主張、見出し、短い引用、本文のハッシュだけで、本文は持たない。
 */

export const CONFIDENCES = ["high", "medium", "low"] as const;
/** passed だけが、先の段階へ進める。held は人の確認待ち、rejected は理由コード付きで残す */
export const CARD_STATUSES = ["passed", "held", "rejected"] as const;

export type Confidence = (typeof CONFIDENCES)[number];
export type CardStatus = (typeof CARD_STATUSES)[number];

const DOMAIN_CODE = z.string().regex(/^domain[1-9][0-9]?$/);

/** 根拠 1 件。アンカーは、節の見出し(ID または見出しの文)と、その節にそのまま出てくる短い引用 */
export const EvidenceSchema = z.strictObject({
  url: SourceUrl,
  /** 人が読む節の名前(分野 > タスクなど) */
  section: z.string().min(1).max(120),
  anchor: z.strictObject({
    heading: z.string().min(1).max(120),
    quote: z.string().min(1).refine(withinQuoteLimit, "引用が長すぎる"),
  }),
  /** 根拠にした本文のハッシュ。モデルの出力ではなく、取り込むときに CLI が入力の本文から入れる */
  contentHash: SHA256,
});

export const ScopeSchema = z.strictObject({
  edition: z.string().min(1).max(16).optional(),
  region: REGION.optional(),
});

export const FactCardSchema = z.strictObject({
  id: ID,
  /** 主張 1 件(言い換えた短い記述。1 件に 1 つの事実) */
  claim: Paraphrase,
  sources: z.array(EvidenceSchema).min(1).max(10),
  /** 適用範囲(対象の版・リージョン) */
  scope: ScopeSchema,
  confidence: z.enum(CONFIDENCES),
  /** 資格マスタの分野のコード */
  domain: DOMAIN_CODE,
  /** 試験ガイドの範囲の項目(台帳の試験ガイドの、その分野の出題範囲の添字)。どの項目にも当たらなければ空 */
  scopeItems: z.array(z.number().int().min(0).max(39)).max(40),
  status: z.enum(CARD_STATUSES),
  /** 保留・不採用の理由コード */
  reasons: z.array(REASON).max(10),
});

export const FactsFileSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  /** 抽出を済ませた出典と本文のハッシュ。同じ入力では、再び抽出を依頼しない */
  /** 抽出済みの出典。agent は、抽出に使ったエージェントの定義(古い記録にはない) */
  extracted: z.array(z.strictObject({ url: SourceUrl, contentHash: SHA256, agent: AgentStampSchema.optional() })),
  cards: z.array(FactCardSchema),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type FactCard = z.infer<typeof FactCardSchema>;
export type FactsFile = z.infer<typeof FactsFileSchema>;

/** 事実カードの検査の誤り。場所(項目のパス)だけを持ち、値は持たない */
export class FactsError extends PathsError {
  constructor(paths: string[]) {
    super("事実カードの誤り", paths);
  }
}

export function emptyFacts(examCode: string): FactsFile {
  return { examCode, extracted: [], cards: [] };
}

export function factsPath(factsDir: string, examCode: string): string {
  return join(factsDir, `${examCode.toLowerCase()}.json`);
}

export function parseFacts(raw: unknown): FactsFile {
  const parsed = FactsFileSchema.safeParse(raw);
  if (!parsed.success) throw new FactsError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const ids = parsed.data.cards.map((c) => c.id);
  const dup = ids.findIndex((id, i) => ids.indexOf(id) !== i);
  if (dup >= 0) throw new FactsError([`cards.${dup}.id`]);
  return parsed.data;
}

export interface FactsContext {
  /** 資格マスタの分野のコード */
  domains: readonly string[];
  /** 台帳の試験ガイドの、分野ごとの出題範囲の項目の数。試験ガイドが未取り込みなら null */
  scopeSizes: Readonly<Record<string, number>> | null;
}

/** 資格マスタ・台帳との突き合わせ。マスタにない分野、試験ガイドにない項目の添字を、場所つきで返す */
export function checkFactsContext(file: FactsFile, ctx: FactsContext): string[] {
  const problems: string[] = [];
  file.cards.forEach((card, i) => {
    if (!ctx.domains.includes(card.domain)) problems.push(`cards.${i}.domain`);
    const size = ctx.scopeSizes?.[card.domain];
    card.scopeItems.forEach((n, j) => {
      if (size !== undefined && n >= size) problems.push(`cards.${i}.scopeItems.${j}`);
    });
  });
  return problems;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

/** 並びを固定する。カードは ID 順、根拠は URL・見出し順、理由と項目は昇順で重複なし */
export function normalizeFacts(file: FactsFile): FactsFile {
  return {
    ...file,
    extracted: [...file.extracted].sort((a, b) => byString(`${a.url} ${a.contentHash}`, `${b.url} ${b.contentHash}`)),
    cards: [...file.cards]
      .sort((a, b) => byString(a.id, b.id))
      .map((c) => ({
        ...c,
        sources: [...c.sources].sort((a, b) =>
          byString(`${a.url} ${a.anchor.heading}`, `${b.url} ${b.anchor.heading}`),
        ),
        scopeItems: [...new Set(c.scopeItems)].sort((a, b) => a - b),
        reasons: [...new Set(c.reasons)].sort(byString),
      })),
  };
}

export function serializeFacts(file: FactsFile): string {
  return `${JSON.stringify(sortKeys(parseFacts(normalizeFacts(file))), null, 2)}\n`;
}

/** 読む。ファイルがなければ空 */
export function readFacts(path: string, examCode: string): FactsFile {
  if (!existsSync(path)) return emptyFacts(examCode);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new FactsError(["(JSON の形)"]);
  }
  const file = parseFacts(raw);
  if (file.examCode !== examCode) throw new FactsError(["examCode"]);
  return file;
}

/** 書く。一時ファイルに書いてから置き換えるので、途中で止まっても壊れたファイルを残さない */
export function writeFacts(path: string, file: FactsFile): void {
  const text = serializeFacts(file);
  writeFileAtomic(path, text);
}
