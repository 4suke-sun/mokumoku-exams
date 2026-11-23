import type { LedgerFile } from "../collect/ledger.ts";
import { usableFact } from "../draft/provenance.ts";
import type { FactsFile } from "../facts/schema.ts";
import type { PlanItem } from "./schema.ts";

/**
 * 計画の項目ごとの、下書きの根拠にできる事実カードの数(出題計画の段階の確かめ)。
 * 誤答は設計ごとに根拠(依頼に載った事実カードの ID か、適用範囲の違い)が要り、根拠のない誤答の下書きは不採用になる。
 * 論点に根拠にできるカードが少ないと、下書きが作り直しになるため、`plan` の報告に出す(止めない。目安であり、質は数に表れない)。
 */

/** 1 つの項目に必要な、根拠にできるカードの目安。選択肢は 4 つ以上(規則 `choice-count`)なので、正答と誤答 3 つで、4 件 */
export const MIN_EVIDENCE_CARDS = 4;

export interface EvidenceCount {
  itemId: string;
  /** 分野の項目は分野の名前、論点の枠の項目は枠の名前 */
  scope: string;
  cards: number;
  /** 目安に届かない */
  short: boolean;
}

/** 下書きの依頼が候補にするカードと同じ範囲(分野の項目は分野、論点の枠の項目は枠の出典の範囲)で、根拠にできるカードを数える */
export function evidenceCounts(items: readonly PlanItem[], facts: FactsFile, ledger: LedgerFile): EvidenceCount[] {
  return items.map((item) => {
    const focus = item.focus;
    const cards = facts.cards.filter(
      (c) =>
        usableFact(c, ledger) &&
        (focus === undefined
          ? c.domain === item.domain
          : c.sources.some((s) => focus.sourcePrefixes.some((p) => s.url.startsWith(p)))),
    ).length;
    return {
      itemId: item.id,
      scope: focus === undefined ? item.domain : `focus:${focus.id}`,
      cards,
      short: cards < MIN_EVIDENCE_CARDS,
    };
  });
}
