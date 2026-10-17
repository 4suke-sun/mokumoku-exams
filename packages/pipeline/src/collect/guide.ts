import { z } from "zod";
import type { AgentStamp } from "../shared/agents.ts";
import { normalize } from "../text.ts";
import type { GuideRecord, LedgerFile } from "./ledger.ts";
import { withinParaphraseLimit } from "./text-limits.ts";

/**
 * 試験ガイドの取り込み(ADR 0009)。分野・配点・出題範囲の抽出は、エージェントが作業用の置き場に書く。
 * CLI は、書かれたものを検査してから台帳に取り込み、資格マスタとの差分を報告する。マスタは書き換えない。
 */

const Paraphrase = z.string().min(1).refine(withinParaphraseLimit);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** エージェントが書く抽出の結果 */
export const GuideExtractSchema = z.strictObject({
  examCode: z.string().min(1),
  sourceUrl: z.string().min(1),
  contentHash: Sha256,
  /** 抽出の材料にした続きのページ。依頼の pages の url と contentHash を写す */
  pages: z
    .array(z.strictObject({ url: z.string().min(1), contentHash: Sha256 }))
    .max(20)
    .default([]),
  domains: z
    .array(
      z.strictObject({
        /** 試験ガイドの分野の番号(1 から) */
        number: z.number().int().min(1).max(20),
        name: Paraphrase,
        /** 配点(%) */
        weightPercent: z.number().min(0).max(100),
        scope: z.array(Paraphrase).max(40),
      }),
    )
    .min(1)
    .max(20),
});

export type GuideExtract = z.infer<typeof GuideExtractSchema>;

/** 抽出を依頼するときに、作業用の置き場に書く内容 */
export interface GuideRequest {
  examCode: string;
  sourceUrl: string;
  contentHash: string;
  /** 本文(キャッシュ)の場所。リポジトリ直下からの相対パス */
  bodyPath: string;
  /** 試験ガイドの続きのページ(計画の guidePages)。分野ごとの出題範囲などを読む */
  pages: { url: string; contentHash: string; bodyPath: string }[];
  /** 抽出の結果を書く場所。リポジトリ直下からの相対パス */
  outputPath: string;
  /** 依頼を出した時点の、エージェントの定義(役・モデルの ID・定義のハッシュ) */
  agent: AgentStamp;
}

/** 配点の合計の許容の幅(%)。ガイドの表記の丸めを許す */
const WEIGHT_SUM_TOLERANCE = 0.5;
/** 本文と一致したら写しとみなす、言い換えの長さ(文字) */
const VERBATIM_MIN_CHARS = 30;

export type GuideStopReason =
  | "extract-invalid"
  | "exam-mismatch"
  | "source-not-in-ledger"
  | "source-not-active"
  | "source-hash-mismatch"
  | "page-mismatch"
  | "body-not-cached"
  | "domain-numbering"
  | "weight-sum-mismatch"
  | "verbatim-copy";

/**
 * 抽出の結果を検査し、台帳に入れる形にする。止めるときは理由コードを返す。
 * readBody は、本文のハッシュからキャッシュの本文を返す。言い換えが、試験ガイドと続きのページの本文の写しでないかを確かめる。
 * pageUrls は、計画の guidePages。抽出が、そのすべてを材料にしていることを確かめる。
 */
export function importGuide(
  raw: unknown,
  ledger: LedgerFile,
  pageUrls: readonly string[],
  readBody: (hash: string) => string | null,
  today: string,
  agent?: AgentStamp,
): { ok: true; guide: GuideRecord } | { ok: false; reason: GuideStopReason } {
  const parsed = GuideExtractSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "extract-invalid" };
  const extract = parsed.data;
  if (extract.examCode !== ledger.examCode) return { ok: false, reason: "exam-mismatch" };
  const source = ledger.sources.find((s) => s.url === extract.sourceUrl && s.kind === "exam-guide");
  if (!source) return { ok: false, reason: "source-not-in-ledger" };
  if (source.status !== "active") return { ok: false, reason: "source-not-active" };
  if (source.contentHash !== extract.contentHash) return { ok: false, reason: "source-hash-mismatch" };
  const extractUrls = extract.pages.map((p) => p.url);
  if (extractUrls.length !== pageUrls.length || pageUrls.some((u) => !extractUrls.includes(u))) {
    return { ok: false, reason: "page-mismatch" };
  }
  for (const page of extract.pages) {
    const entry = ledger.sources.find((s) => s.url === page.url);
    if (entry?.status !== "active") return { ok: false, reason: "source-not-active" };
    if (entry.contentHash !== page.contentHash) return { ok: false, reason: "source-hash-mismatch" };
  }
  const bodies = [extract.contentHash, ...extract.pages.map((p) => p.contentHash)].map(readBody);
  if (bodies.some((b) => b === null)) return { ok: false, reason: "body-not-cached" };

  const numbers = extract.domains.map((d) => d.number).sort((a, b) => a - b);
  if (numbers.some((n, i) => n !== i + 1)) return { ok: false, reason: "domain-numbering" };
  const sum = extract.domains.reduce((s, d) => s + d.weightPercent, 0);
  if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) return { ok: false, reason: "weight-sum-mismatch" };

  const plains = bodies.map((b) => normalize(b ?? ""));
  const texts = extract.domains.flatMap((d) => [d.name, ...d.scope]).map(normalize);
  if (texts.some((t) => t.length >= VERBATIM_MIN_CHARS && plains.some((p) => p.includes(t)))) {
    return { ok: false, reason: "verbatim-copy" };
  }

  return {
    ok: true,
    guide: {
      sourceUrl: extract.sourceUrl,
      contentHash: extract.contentHash,
      pages: extract.pages,
      importedAt: today,
      ...(agent !== undefined ? { agent } : {}),
      domains: [...extract.domains]
        .sort((a, b) => a.number - b.number)
        .map((d) => ({
          code: `domain${d.number}`,
          name: d.name,
          weight: Math.round(d.weightPercent * 100) / 10000,
          scope: d.scope,
        })),
    },
  };
}

export interface GuideDiff {
  /** 試験ガイドにあって、マスタにない分野 */
  missingInMaster: string[];
  /** マスタにあって、試験ガイドにない分野 */
  extraInMaster: string[];
  /** 配点のずれ */
  weightMismatch: { code: string; guide: number; master: number }[];
}

/** 配点を同じとみなす幅(割合) */
const WEIGHT_TOLERANCE = 0.005;

export function diffWithMaster(guide: GuideRecord, master: readonly { code: string; weight: number }[]): GuideDiff {
  const masterByCode = new Map(master.map((d) => [d.code, d.weight]));
  const guideCodes = new Set(guide.domains.map((d) => d.code));
  const diff: GuideDiff = { missingInMaster: [], extraInMaster: [], weightMismatch: [] };
  for (const d of guide.domains) {
    const weight = masterByCode.get(d.code);
    if (weight === undefined) diff.missingInMaster.push(d.code);
    else if (Math.abs(weight - d.weight) > WEIGHT_TOLERANCE) {
      diff.weightMismatch.push({ code: d.code, guide: d.weight, master: weight });
    }
  }
  for (const d of master) if (!guideCodes.has(d.code)) diff.extraInMaster.push(d.code);
  return diff;
}
