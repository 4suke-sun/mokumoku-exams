import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { Paraphrase, REGION, SHA256 } from "../collect/ledger.ts";
import { withinQuoteLimit } from "../collect/text-limits.ts";
import { compact } from "../text.ts";
import { CONFIDENCES, type FactCard } from "./schema.ts";

/**
 * 事実カードの抽出(ADR 0009)。モデルを使う抽出は、エージェント(fact-extractor)が、作業用の置き場に書く。
 * CLI は、書かれたものを検査してから取り込む。本文のハッシュは、モデルの出力ではなく、依頼のもとにした本文から入れる。
 */

/** エージェントが書く候補。本文のハッシュと ID は持たない(CLI が入れる) */
export const CandidateSchema = z.strictObject({
  claim: Paraphrase,
  section: z.string().min(1).max(120),
  anchor: z.strictObject({
    heading: z.string().min(1).max(120),
    quote: z.string().min(1).refine(withinQuoteLimit, "引用が長すぎる"),
  }),
  scope: z
    .strictObject({
      edition: z.string().min(1).max(16).optional(),
      region: REGION.optional(),
    })
    .optional(),
  confidence: z.enum(CONFIDENCES),
  domain: z.string().regex(/^domain[1-9][0-9]?$/),
  scopeItems: z.array(z.number().int().min(0).max(39)).max(40).default([]),
});

export const FactsOutputSchema = z.strictObject({
  examCode: z.string().min(1),
  sourceUrl: z.string().min(1),
  contentHash: SHA256,
  cards: z.array(CandidateSchema).max(200),
});

export type FactsOutput = z.infer<typeof FactsOutputSchema>;

/** 抽出を依頼するときに、作業用の置き場に書く内容 */
export interface FactsRequest {
  examCode: string;
  sourceUrl: string;
  contentHash: string;
  /** 本文(キャッシュ)の場所。リポジトリ直下からの相対パス */
  bodyPath: string;
  /** 抽出の結果を書く場所。リポジトリ直下からの相対パス */
  outputPath: string;
  /** 出典の対象の版・リージョン。カードに適用範囲がなければ、これを使う */
  target: { edition?: string; region?: string };
  /** 分野。scope は、試験ガイドの出題範囲の項目(添字が scopeItems の値) */
  domains: { code: string; name: string; scope: string[] }[];
}

/** 依頼と結果のファイル名。出典と本文のハッシュから決まる */
export function requestKey(url: string, contentHash: string): string {
  return sha256(Buffer.from(`${url}\n${contentHash}`)).slice(0, 16);
}

/** カードの ID。出典・見出し・主張・分野から決まるので、同じ抽出なら同じ ID になる */
export function cardId(url: string, heading: string, claim: string, domain: string): string {
  return `f-${sha256(Buffer.from([url, compact(heading), compact(claim), domain].join("\n"))).slice(0, 12)}`;
}

/** 候補を事実カードにする。本文のハッシュと ID は CLI が入れる。同じ ID の候補は最初の 1 件だけ残す */
export function buildCards(
  output: FactsOutput,
  source: { url: string; contentHash: string; target: { edition?: string; region?: string } },
): FactCard[] {
  const seen = new Set<string>();
  const cards: FactCard[] = [];
  for (const c of output.cards) {
    const id = cardId(source.url, c.anchor.heading, c.claim, c.domain);
    if (seen.has(id)) continue;
    seen.add(id);
    const scope = {
      ...((c.scope?.edition ?? source.target.edition) ? { edition: c.scope?.edition ?? source.target.edition } : {}),
      ...((c.scope?.region ?? source.target.region) ? { region: c.scope?.region ?? source.target.region } : {}),
    };
    cards.push({
      id,
      claim: c.claim,
      sources: [{ url: source.url, section: c.section, anchor: c.anchor, contentHash: source.contentHash }],
      scope,
      confidence: c.confidence,
      domain: c.domain,
      scopeItems: c.scopeItems,
      status: "passed",
      reasons: [],
    });
  }
  return cards;
}
