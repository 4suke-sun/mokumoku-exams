import type { FactCard, FactsFile } from "../facts/schema.ts";
import { factSource } from "./request.ts";
import { type ChoiceDraft, isChoiceDraft } from "./schema.ts";
import type { DraftRecord, DraftsFile } from "./store.ts";

/**
 * 保留の下書きを直す(ブラッシュアップ役 question-reviser。docs/drafting.md の「直し」)。
 * 直す材料は、元の下書き、保留の理由、検証の指摘、根拠の節の場所、周辺の事実カード。
 * 直した下書きは新しい下書きとして取り込みと検証を通し、元の下書きとのつながり(revisionOf)を記録に残す。
 */

/** 写しを確かめられない保留の理由コード(直しでは解けない) */
const COPY_UNCHECKED = "review:copy-unchecked";

/** 本文を持つ保留の選択式の下書き */
export type RevisableRecord = DraftRecord & { status: "held"; draft: ChoiceDraft };

/**
 * 直す対象: 保留の選択式の下書きで、人の判断(承認・解除・却下)がまだないもの。
 * 却下した下書き(本文を持たない)と、自由記述(再導出の形で検証できず、保留が直しでは解けない)は対象にしない。
 * 写しを確かめられない保留(review:copy-unchecked)も対象にしない。本文のキャッシュを戻して作り直さないと解けず、直しても同じ理由で保留に戻る。
 */
export function reviseTargets(
  drafts: DraftsFile,
  decisionOf: (id: string) => "approve" | "release" | "reject" | undefined,
): RevisableRecord[] {
  return drafts.drafts.filter(
    (d): d is RevisableRecord =>
      d.status === "held" &&
      d.draft !== null &&
      isChoiceDraft(d.draft) &&
      !d.reasons.includes(COPY_UNCHECKED) &&
      decisionOf(d.id) === undefined,
  );
}

/** 根拠の節の場所。事実カードの先頭の出典の、URL・人が読む節の名前・見出し(検証の段階が切り出す節と同じ)。重複は除く */
export interface EvidenceLocation {
  url: string;
  section: string;
  heading: string;
}

/**
 * 下書きの根拠の事実カードから、検証役が読む節の場所を返す(検証の依頼の節の切り出し collectSections と同じ選び方)。
 * 本文は読まないので、キャッシュに本文がなくても場所は返せる。事実カードがないものは飛ばす
 */
export function evidenceLocations(factIds: readonly string[], facts: FactsFile): EvidenceLocation[] {
  const seen = new Set<string>();
  const out: EvidenceLocation[] = [];
  for (const id of [...new Set(factIds)].sort()) {
    const evidence = facts.cards.find((c) => c.id === id)?.sources[0];
    if (evidence === undefined) continue;
    const marker = `${evidence.contentHash}\n${evidence.anchor.heading}`;
    if (seen.has(marker)) continue;
    seen.add(marker);
    out.push({ url: evidence.url, section: evidence.section, heading: evidence.anchor.heading });
  }
  return out;
}

/**
 * 直しの依頼に載せる事実カード。元の下書きの根拠のカードを先に(使えるものだけ)、続けて周辺のカードを、
 * 元の根拠と同じ出典のもの、同じ出題範囲の項目のもの、それ以外の順に、それぞれ根拠にされた回数の少ないもの、ID の順に並べ、max 件まで取る。
 * candidates は、同じ分野の使える(通過した、再検証の印がない、出典が使える)カード。
 * 書き直しの依頼(非公開の問題)も、元の根拠の事実カードの ID を渡して、同じ選び方にする。
 */
export function reviseFacts(
  original: { draft: { factIds: readonly string[] } },
  candidates: readonly FactCard[],
  usage: ReadonlyMap<string, number>,
  max: number,
): FactCard[] {
  const own = original.draft.factIds.flatMap((id) => candidates.filter((c) => c.id === id));
  const ownIds = new Set(own.map((c) => c.id));
  const sources = new Set(own.map(factSource));
  const scope = new Set(own.flatMap((c) => c.scopeItems));
  const closeness = (c: FactCard) => (sources.has(factSource(c)) ? 0 : c.scopeItems.some((i) => scope.has(i)) ? 1 : 2);
  const neighbors = candidates
    .filter((c) => !ownIds.has(c.id))
    .sort(
      (a, b) =>
        closeness(a) - closeness(b) ||
        (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  return [...own, ...neighbors].slice(0, max);
}
