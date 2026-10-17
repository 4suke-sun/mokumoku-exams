import type { BodyCache } from "../collect/cache.ts";
import type { FactsFile } from "../facts/schema.ts";
import { detectCopy } from "../shared/copy.ts";
import { type Draft, isChoiceDraft } from "./schema.ts";

/**
 * 下書きが、根拠の出典の本文を長く写していないか(試験ガイド・事実カードの主張と同じ関数。shared/copy.ts の detectCopy)。
 * キャッシュにある本文のどれかを長く写していれば "copy"(本文がない出典があっても、写しは写しとして落とす)。
 * 写しが見つからず、本文がキャッシュにない出典があれば、確かめきれないので "unchecked"(取り込みは保留にする)。
 */
export function copyCheck(draft: Draft, facts: FactsFile, cache: BodyCache): "copy" | "unchecked" | "ok" {
  const hashes = new Set(
    draft.factIds.flatMap((id) => facts.cards.find((c) => c.id === id)?.sources.map((s) => s.contentHash) ?? []),
  );
  const bodies: string[] = [];
  let missing = false;
  for (const hash of hashes) {
    const body = cache.read(hash);
    if (body === null) missing = true;
    else bodies.push(body.toString("utf8"));
  }
  const texts = [
    draft.questionText,
    draft.explanation,
    draft.supplement ?? "",
    ...(isChoiceDraft(draft)
      ? [
          ...draft.choices.flatMap((c) => [c.text, c.explanation ?? ""]),
          ...(draft.distractors ?? []).map((d) => d.reason),
        ]
      : []),
  ];
  if (texts.some((t) => t !== "" && detectCopy(t, bodies) !== null)) return "copy";
  return missing ? "unchecked" : "ok";
}
