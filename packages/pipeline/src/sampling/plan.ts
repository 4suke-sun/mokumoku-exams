import type { Config } from "../config.ts";
import { type DecisionsFile, draftDecision } from "../decisions/decisions.ts";
import type { ProvenanceFile } from "../draft/provenance.ts";
import type { DraftRecord, DraftsFile } from "../draft/store.ts";
import { seededRandom } from "../facts/review.ts";
import type { FactCard, FactsFile } from "../facts/schema.ts";

/**
 * 人の確認の抜き取り(全件の確認と、リスクの高いものを優先した抜き取りの切り替え)。
 * 通過した事実カードと下書きだけが、抜き取りの対象。保留と不採用は対象にしない(人が解くまで先へ進めない)。
 * 同じ入力・同じ率・同じ種から、同じものが選ばれる。切り替えは、検証役の評価が目標を満たしたときだけ。
 * 持つのは、ID と件数と理由だけで、本文は含まない。
 */

export type ReviewMode = "full" | "sample";

/** 全件の確認のままにした理由。抜き取りにしたときは null */
export type FallbackReason = "not-requested" | "eval-missing" | "eval-not-met" | "eval-stale" | "reject-rate-high";

export interface SamplingSettings {
  mode: ReviewMode;
  /** 抜き取りの率(0〜1)。通過したものの件数に対する、確認する件数の割合 */
  rate: number;
  seed: number;
  /** 重複の類似度が、保留のしきい値からこの幅以内なら「保留に近い」 */
  nearHoldMargin: number;
  /** この点数以上のものは、率にかかわらず全件を確認する */
  highRiskScore: number;
  /** 抜き取りで人が却下した割合が、これを超えたら全件の確認へ戻す */
  maxRejectRate: number;
  /** 戻すかを判断するのに必要な、人の判断の最小の件数 */
  minDecisions: number;
}

/** 検証役の評価のレポートから読む値 */
export interface EvalSummary {
  meetsTargets: boolean;
  definitionHash: string;
}

export interface SamplingGroup {
  /** 通過したもの(抜き取りの対象)の件数 */
  eligible: number;
  /** 人が確認するもの(ID) */
  reviewed: string[];
  /** 確認しないもの(ID)。検証を通っていれば、承認なしで書き出せる(下書きのみ) */
  notReviewed: string[];
}

export interface SamplingPlan {
  /** 設定で求めたモード */
  requested: ReviewMode;
  /** 実際に使うモード */
  mode: ReviewMode;
  /** 全件の確認のままにした理由(抜き取りのときは null) */
  fallback: FallbackReason | null;
  rate: number;
  seed: number;
  /** 抜き取りで人が却下した割合(判断が足りないときは null) */
  rejectRate: number | null;
  /** 評価のレポートの検証役の定義のハッシュ(あれば) */
  evalDefinitionHash: string | null;
  draft: SamplingGroup;
  fact: SamplingGroup;
}

/** 前回の抜き取りの記録から読む値(却下の割合を測るため) */
export interface PreviousSampling {
  reviewedDraftIds: readonly string[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function hashString(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) as number), 16777619);
  return h >>> 0;
}

interface Scored {
  id: string;
  score: number;
}

/**
 * 通過したものから、確認するものを選ぶ。点数の高いものを先に、同じ点数の中は種から決まる並びで、
 * `max(率で決まる件数, 点数が highRiskScore 以上の件数)` 件を選ぶ。率 0 なら、リスクの高いものだけ。率 1 なら、すべて。
 */
export function selectReview(
  items: readonly Scored[],
  settings: Pick<SamplingSettings, "rate" | "seed" | "highRiskScore">,
  salt: string,
): SamplingGroup {
  const random = seededRandom(settings.seed ^ hashString(salt));
  const ordered = [...items]
    .sort((a, b) => byString(a.id, b.id))
    .map((item) => ({ ...item, tie: random() }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie);
  const quota = Math.min(items.length, Math.ceil(items.length * Math.min(Math.max(settings.rate, 0), 1)));
  const high = items.filter((i) => i.score >= settings.highRiskScore).length;
  const take = Math.max(quota, high);
  return {
    eligible: items.length,
    reviewed: ordered
      .slice(0, take)
      .map((i) => i.id)
      .sort(byString),
    notReviewed: ordered
      .slice(take)
      .map((i) => i.id)
      .sort(byString),
  };
}

/** 指定した ID は、抜き取りでも必ず確認するものにする */
function forceReview(group: SamplingGroup, ids: readonly string[]): SamplingGroup {
  const forced = new Set(ids);
  return {
    ...group,
    reviewed: [...group.reviewed, ...group.notReviewed.filter((id) => forced.has(id))].sort(byString),
    notReviewed: group.notReviewed.filter((id) => !forced.has(id)),
  };
}

const scopeKey = (domain: string, item: number) => `${domain}#${item}`;

/** 事実カードの論点(分野と出題範囲の項目の組) */
function topics(card: FactCard): string[] {
  return card.scopeItems.map((n) => scopeKey(card.domain, n));
}

export interface SamplingInput {
  settings: SamplingSettings;
  /** 下書きの重複の類似度のしきい値(draft.similarity.hold) */
  holdThreshold: number;
  drafts: DraftsFile;
  facts: FactsFile;
  provenance: ProvenanceFile;
  decisions: DecisionsFile;
  /** 検証役の評価のレポート。なければ null */
  evalSummary: EvalSummary | null;
  /** 今の検証役の定義のハッシュ */
  verifierDefinitionHash: string;
  previous: PreviousSampling | null;
}

export function computeSampling(input: SamplingInput): SamplingPlan {
  const { settings, drafts, facts, provenance, decisions } = input;
  const passedDrafts = drafts.drafts.filter((d) => d.status === "passed" && d.draft !== null);
  const passedFacts = facts.cards.filter((c) => c.status === "passed");

  // 人が承認した下書きがすでに扱っている論点
  const cardById = new Map(facts.cards.map((c) => [c.id, c]));
  const covered = new Set(
    drafts.drafts
      .filter((d) => d.draft !== null && draftDecision(decisions, d.id) === "approve")
      .flatMap((d) =>
        (d.draft?.factIds ?? []).flatMap((id) =>
          topics(cardById.get(id) ?? ({ scopeItems: [], domain: "" } as unknown as FactCard)),
        ),
      ),
  );

  const draftScore = (d: DraftRecord): number => {
    const draft = d.draft;
    if (draft === null) return 0;
    const cards = draft.factIds.flatMap((id) => cardById.get(id) ?? []);
    const draftTopics = cards.flatMap(topics);
    const entry = provenance.entries.find((e) => e.draftId === d.id);
    return (
      (d.warnings.length > 0 ? 1 : 0) +
      (d.similarity !== undefined && d.similarity >= input.holdThreshold - settings.nearHoldMargin ? 1 : 0) +
      (draftTopics.length === 0 || draftTopics.some((t) => !covered.has(t)) ? 1 : 0) +
      (entry === undefined || entry.sources.length <= 1 ? 1 : 0)
    );
  };
  const factScore = (c: FactCard): number =>
    (c.confidence === "high" ? 0 : 1) +
    (c.scopeItems.length === 0 || topics(c).some((t) => !covered.has(t)) ? 1 : 0) +
    (c.sources.length <= 1 ? 1 : 0);

  const full = (): { draft: SamplingGroup; fact: SamplingGroup } => ({
    draft: {
      eligible: passedDrafts.length,
      reviewed: passedDrafts.map((d) => d.id).sort(byString),
      notReviewed: [],
    },
    fact: { eligible: passedFacts.length, reviewed: passedFacts.map((c) => c.id).sort(byString), notReviewed: [] },
  });

  // 却下の割合: 前回の抜き取りで確認するとした下書きに、人が下した判断(承認・却下)の中の、却下の割合
  let rejectRate: number | null = null;
  if (input.previous !== null) {
    const decided = input.previous.reviewedDraftIds.flatMap((id) => draftDecision(decisions, id) ?? []);
    const judged = decided.filter((d) => d === "approve" || d === "reject");
    if (judged.length >= settings.minDecisions)
      rejectRate = judged.filter((d) => d === "reject").length / judged.length;
  }

  let fallback: FallbackReason | null = null;
  if (settings.mode === "full") fallback = "not-requested";
  else if (input.evalSummary === null) fallback = "eval-missing";
  else if (input.evalSummary.definitionHash !== input.verifierDefinitionHash) fallback = "eval-stale";
  else if (!input.evalSummary.meetsTargets) fallback = "eval-not-met";
  else if (rejectRate !== null && rejectRate > settings.maxRejectRate) fallback = "reject-rate-high";

  const base = {
    requested: settings.mode,
    rate: settings.rate,
    seed: settings.seed,
    rejectRate,
    evalDefinitionHash: input.evalSummary?.definitionHash ?? null,
  };
  if (fallback !== null) return { ...base, mode: "full", fallback, ...full() };
  return {
    ...base,
    mode: "sample",
    fallback: null,
    draft: forceReview(
      selectReview(
        passedDrafts.map((d) => ({ id: d.id, score: draftScore(d) })),
        settings,
        "draft",
      ),
      // 非公開の問題を書き直した下書きは、公開へ戻る前に、人が必ず確認する(抜き取りにしない。ADR 0023)
      passedDrafts.filter((d) => d.rewriteOf !== undefined).map((d) => d.id),
    ),
    fact: selectReview(
      passedFacts.map((c) => ({ id: c.id, score: factScore(c) })),
      settings,
      "fact",
    ),
  };
}

export function settingsOf(config: Config): SamplingSettings {
  return config.review;
}
