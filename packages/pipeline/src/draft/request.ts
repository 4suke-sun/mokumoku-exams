import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import type { FactCard } from "../facts/schema.ts";
import { DIFFICULTIES } from "../plan/schema.ts";
import { AgentStampSchema } from "../shared/agents.ts";
import { DISTRACTOR_TYPES, DraftSchema, FACT_ID } from "./schema.ts";
import { STYLE_RULES, STYLE_VERSION } from "./style.ts";

/** 依頼の形が変わったら上げる。鍵に入るので、上げると依頼のキャッシュが切れる */
export const REQUEST_VERSION = 5;

/** エージェントへの依頼(作業用の置き場に書く)。事実カードの主張は、言い換えた短い文 */
export const DraftRequestSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().regex(/^[0-9a-f]{16}$/),
  planItemId: z.string().regex(/^p-[0-9a-f]{12}$/),
  domain: z.strictObject({ code: z.string().min(1), name: z.string().min(1) }),
  difficulty: z.enum(DIFFICULTIES),
  kind: z.enum(["single", "multiple", "free-text"]),
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
  /** 選択式の下書きごとに、正答を置く記号(書かせる数と同じ長さ)。正答の位置の偏りを防ぐ。自由記述にはない */
  answerPositions: z
    .array(z.array(z.string().regex(/^[A-Z]$/)).min(1))
    .min(1)
    .optional(),
  /** 誤答の型の一覧。誤答ごとに型を選ぶ */
  distractorTypes: z.array(z.enum(DISTRACTOR_TYPES)).min(1),
  styleVersion: z.number().int(),
  /** 資格ごとの出題スタイルの指針の文書(リポジトリ直下からの相対パス)。点数票の帯のある資格だけ */
  styleGuides: z
    .array(z.string().regex(/^docs\/exam-style\/[a-z0-9-]+\.md$/))
    .min(1)
    .optional(),
  styleRules: z.array(z.strictObject({ name: z.string(), severity: z.enum(["block", "warn"]), summary: z.string() })),
  /** 結果を書く場所。リポジトリ直下からの相対パス */
  outputPath: z.string().min(1),
  /** 依頼を出した時点の、エージェントの定義(役・モデルの ID・定義のハッシュ) */
  agent: AgentStampSchema.optional(),
});

export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** エージェントが書く出力。依頼の鍵と計画の項目を写す */
export const DraftsOutputSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().min(1),
  planItemId: z.string().min(1),
  drafts: z.array(DraftSchema).min(1).max(100),
});

export type DraftsOutput = z.infer<typeof DraftsOutputSchema>;

/** 依頼の種別に適用するスタイル規則の説明 */
export function styleRuleSummaries(kind: DraftRequest["kind"]): DraftRequest["styleRules"] {
  const applies = kind === "free-text" ? "free-text" : "choice";
  return STYLE_RULES.filter((r) => r.appliesTo === "both" || r.appliesTo === applies).map((r) => ({
    name: r.name,
    severity: r.severity,
    summary: r.summary,
  }));
}

/**
 * 依頼の鍵。入力(計画の項目、書かせる数、出し直しの回数、事実カードの ID と主張、規則と依頼の版、エージェントの定義のハッシュ、
 * 人が却下した下書きの数)から決まる。同じ入力では同じ鍵になり、取り込み済みの鍵は、再び依頼しない。
 * 人が却下した数は、1 件以上のときだけ鍵に入れる(却下のない項目の鍵は、これを足す前と変わらない)。
 * 却下が増えると鍵が変わるので、却下で足りなくなった分の依頼が、取り込み済みの依頼と同じ鍵で飛ばされない。
 */
export function requestKey(input: {
  examCode: string;
  planItemId: string;
  count: number;
  round: number;
  facts: readonly { id: string; claim: string }[];
  /** エージェントの定義のハッシュ。定義が変わると鍵が変わる */
  definitionHash: string;
  /** 計画の項目の、人が却下した下書きの数 */
  humanRejected?: number;
}): string {
  const canonical = JSON.stringify({
    examCode: input.examCode,
    planItemId: input.planItemId,
    count: input.count,
    round: input.round,
    facts: input.facts.map((f) => [f.id, sha256(Buffer.from(f.claim))]),
    styleVersion: STYLE_VERSION,
    requestVersion: REQUEST_VERSION,
    definitionHash: input.definitionHash,
    ...(input.humanRejected ? { humanRejected: input.humanRejected } : {}),
  });
  return sha256(Buffer.from(canonical)).slice(0, 16);
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** 事実カードの出典の URL(先頭の出典)。出典の偏りを数える単位 */
export function factSource(card: FactCard): string {
  return card.sources[0]?.url ?? "";
}

/**
 * 依頼に載せる事実カードを選ぶ。通過したカードのうち、まだ下書きの根拠にされていないものを先に、
 * 根拠にされた回数の少ない出典のものを先に、確度の高いものを先に、ID の順に並べる。
 * そのうえで、同じ出典のカードが続かないよう、出典を 1 巡ずつ回して上限まで取る。同じ入力なら同じ選び方になる。
 */
export function selectFacts(
  cards: readonly FactCard[],
  usage: ReadonlyMap<string, number>,
  max: number,
  sourceUsage: ReadonlyMap<string, number> = new Map(),
): FactCard[] {
  const sorted = [...cards].sort(
    (a, b) =>
      (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) ||
      (sourceUsage.get(factSource(a)) ?? 0) - (sourceUsage.get(factSource(b)) ?? 0) ||
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const selected: FactCard[] = [];
  let rest = sorted;
  while (selected.length < max && rest.length > 0) {
    const seen = new Set<string>();
    const next: FactCard[] = [];
    for (const card of rest) {
      const source = factSource(card);
      if (selected.length < max && !seen.has(source)) {
        seen.add(source);
        selected.push(card);
      } else {
        next.push(card);
      }
    }
    rest = next;
  }
  return selected;
}

/** 選択式の種別ごとの、正答の位置に使う記号(単一は 4 択、複数は 5 択から 2 つ) */
const POSITION_LETTERS = { single: ["A", "B", "C", "D"], multiple: ["A", "B", "C", "D", "E"] } as const;

/** 正答の位置の組を数える鍵(記号を順に並べて連ねる) */
export function positionKey(letters: readonly string[]): string {
  return [...letters].sort().join("");
}

/**
 * 依頼の下書きごとに、正答を置く記号を決める。これまでの下書きで使われた回数(組、次に記号)の少ないものを先に、記号の順に選ぶ。
 * 選んだ分は counts に足すので、同じ実行の次の依頼は、残りの少ない位置から選ぶ。
 */
export function assignAnswerPositions(
  kind: "single" | "multiple",
  count: number,
  counts: Map<string, number>,
): string[][] {
  const letters = POSITION_LETTERS[kind];
  const candidates: string[][] =
    kind === "single" ? letters.map((l) => [l]) : letters.flatMap((a, i) => letters.slice(i + 1).map((b) => [a, b]));
  const letterCount = (l: string) =>
    [...counts.entries()].reduce((sum, [key, n]) => (key.includes(l) ? sum + n : sum), 0);
  const result: string[][] = [];
  for (let i = 0; i < count; i++) {
    const scored = candidates.map((c) => ({
      c,
      pair: counts.get(positionKey(c)) ?? 0,
      letters: c.reduce((sum, l) => sum + letterCount(l), 0),
    }));
    scored.sort((a, b) => a.pair - b.pair || a.letters - b.letters || positionKey(a.c).localeCompare(positionKey(b.c)));
    const chosen = scored[0]?.c ?? [letters[0]];
    result.push(chosen);
    counts.set(positionKey(chosen), (counts.get(positionKey(chosen)) ?? 0) + 1);
  }
  return result;
}
