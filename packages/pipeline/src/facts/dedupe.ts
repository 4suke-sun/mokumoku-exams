import { jaccard } from "../shared/similarity.ts";
import { compact } from "../text.ts";
import { extractNumbers, extractTerms } from "./grounding.ts";
import type { Confidence, FactCard } from "./schema.ts";

/**
 * 事実カードの重複と矛盾の検出。安い機械的な比較(正規化した主張、数値、固有名詞)だけを行う。
 * 版やリージョンが違う(適用範囲が異なる)カードは、矛盾にせず、両方を残す。
 */

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function sameScope(a: FactCard, b: FactCard): boolean {
  return a.scope.edition === b.scope.edition && a.scope.region === b.scope.region;
}

const MAX_SOURCES = 10;

/**
 * 同じ主張(正規化して一致し、分野と適用範囲が同じ)のカードを 1 件にまとめる。ID の小さいカードを残し、
 * 根拠の出典をすべて残す。確度は低いほうに合わせる。不採用のカードは、そのままにする。
 */
export function mergeDuplicates(cards: readonly FactCard[]): { cards: FactCard[]; merged: number } {
  const sorted = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const keep: FactCard[] = [];
  const index = new Map<string, number>();
  let merged = 0;
  for (const card of sorted) {
    if (card.status === "rejected") {
      keep.push(card);
      continue;
    }
    const key = [compact(card.claim), card.domain, card.scope.edition ?? "", card.scope.region ?? ""].join("\u0000");
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, keep.length);
      keep.push(card);
      continue;
    }
    const base = keep[at] as FactCard;
    const seen = new Set(base.sources.map((s) => `${s.url} ${s.anchor.heading}`));
    const extra = card.sources.filter((s) => !seen.has(`${s.url} ${s.anchor.heading}`));
    keep[at] = {
      ...base,
      sources: [...base.sources, ...extra].slice(0, MAX_SOURCES),
      scopeItems: [...new Set([...base.scopeItems, ...card.scopeItems])].sort((x, y) => x - y),
      confidence: RANK[card.confidence] < RANK[base.confidence] ? card.confidence : base.confidence,
    };
    merged++;
  }
  return { cards: keep, merged };
}

/** 主張どうしの似かた(文字 2 つ組の Jaccard 係数。`shared/similarity.ts`) */
export const similarity = jaccard;

/** 矛盾とみなす主張の似かたの下限 */
export const CONFLICT_MIN_SIMILARITY = 0.5;

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export interface ConflictPair {
  a: string;
  b: string;
}

/**
 * 矛盾の候補。適用範囲が同じで、同じ固有名詞の組を持ち、主張が似ていて、数値の組が食い違うものを矛盾とする。
 * 自動で白黒をつけない。見つけたら、どちらも保留にして、人の確認(レビューレポート)へ回す。
 */
export function detectConflicts(cards: readonly FactCard[]): ConflictPair[] {
  const live = cards.filter((c) => c.status !== "rejected");
  const facts = live.map((card) => ({
    card,
    terms: extractTerms(card.claim),
    numbers: extractNumbers(card.claim),
  }));
  const pairs: ConflictPair[] = [];
  for (let i = 0; i < facts.length; i++) {
    for (let j = i + 1; j < facts.length; j++) {
      const x = facts[i];
      const y = facts[j];
      if (!x || !y || !sameScope(x.card, y.card)) continue;
      if (x.terms.length === 0 || !sameList(x.terms, y.terms)) continue;
      if (x.numbers.length === 0 || y.numbers.length === 0 || sameList(x.numbers, y.numbers)) continue;
      if (similarity(x.card.claim, y.card.claim) < CONFLICT_MIN_SIMILARITY) continue;
      const [a, b] = [x.card.id, y.card.id].sort();
      pairs.push({ a: a as string, b: b as string });
    }
  }
  return pairs;
}
