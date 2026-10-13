import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import type { FactCard } from "../facts/schema.ts";
import { DIFFICULTIES } from "../plan/schema.ts";
import { ChoiceDraftSchema, FACT_ID } from "./schema.ts";
import { STYLE_RULES, STYLE_VERSION } from "./style.ts";

/** 依頼の形が変わったら上げる。鍵に入るので、上げると依頼のキャッシュが切れる */
export const REQUEST_VERSION = 1;

/** エージェントへの依頼(作業用の置き場に書く)。事実カードの主張は、言い換えた短い文 */
export const DraftRequestSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().regex(/^[0-9a-f]{16}$/),
  planItemId: z.string().regex(/^p-[0-9a-f]{12}$/),
  domain: z.strictObject({ code: z.string().min(1), name: z.string().min(1) }),
  difficulty: z.enum(DIFFICULTIES),
  kind: z.enum(["single", "multiple"]),
  /** 書かせる下書きの数(最大) */
  count: z.number().int().min(1).max(100),
  facts: z
    .array(
      z.strictObject({
        id: FACT_ID,
        claim: z.string().min(1),
        confidence: z.enum(["high", "medium", "low"]),
        scope: z.strictObject({ edition: z.string().optional(), region: z.string().optional() }),
      }),
    )
    .min(1),
  styleVersion: z.number().int(),
  styleRules: z.array(z.strictObject({ name: z.string(), severity: z.enum(["block", "warn"]), summary: z.string() })),
  /** 結果を書く場所。リポジトリ直下からの相対パス */
  outputPath: z.string().min(1),
});

export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** エージェントが書く出力。依頼の鍵と計画の項目を写す */
export const DraftsOutputSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().min(1),
  planItemId: z.string().min(1),
  drafts: z.array(ChoiceDraftSchema).min(1).max(100),
});

export type DraftsOutput = z.infer<typeof DraftsOutputSchema>;

export function styleRuleSummaries(): DraftRequest["styleRules"] {
  return STYLE_RULES.map((r) => ({ name: r.name, severity: r.severity, summary: r.summary }));
}

/**
 * 依頼の鍵。入力(計画の項目、書かせる数、出し直しの回数、事実カードの ID と主張、規則と依頼の版)から決まる。
 * 同じ入力では同じ鍵になり、取り込み済みの鍵は、再び依頼しない。
 */
export function requestKey(input: {
  examCode: string;
  planItemId: string;
  count: number;
  round: number;
  facts: readonly { id: string; claim: string }[];
}): string {
  const canonical = JSON.stringify({
    examCode: input.examCode,
    planItemId: input.planItemId,
    count: input.count,
    round: input.round,
    facts: input.facts.map((f) => [f.id, sha256(Buffer.from(f.claim))]),
    styleVersion: STYLE_VERSION,
    requestVersion: REQUEST_VERSION,
  });
  return sha256(Buffer.from(canonical)).slice(0, 16);
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * 依頼に載せる事実カードを選ぶ。通過したカードのうち、まだ下書きの根拠にされていないものを先に、
 * 確度の高いものを先に、ID の順に並べ、上限まで取る。同じ入力なら同じ選び方になる。
 */
export function selectFacts(cards: readonly FactCard[], usage: ReadonlyMap<string, number>, max: number): FactCard[] {
  return [...cards]
    .sort(
      (a, b) =>
        (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) ||
        CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, max);
}
