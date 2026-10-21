import { compact, normalize } from "../text.ts";
import type { Evidence } from "./schema.ts";
import { findSection } from "./sections.ts";

/**
 * 事実カードの根拠を、取得した本文と機械的に照合する(モデルを使わない)。
 * アンカーの見出しで本文の範囲を絞り、その範囲に、引用・数値・固有名詞があるかを確かめる。
 * 引用は、取り込むときにだけ使う(エージェントの出力にあり、台帳には残さない)。
 * 結果は理由コードだけで、本文や一致した文字列は含めない。
 */

export type GroundingReason =
  | "source-not-active"
  | "hash-mismatch"
  | "body-not-cached"
  | "anchor-not-found"
  | "quote-not-found"
  | "number-mismatch"
  | "term-not-found";

/**
 * 主張に含まれる数値(全角は半角にそろえる。桁区切りは落とす)。サービス名の中の数字(S3 など)と、
 * 数えことばの「1 つ」「2 つ」は数えない(出典の数値ではなく、言い換えの言い回しなので)。
 */
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.normalize("NFKC").matchAll(/(?<![A-Za-z0-9])\d+(?:[.,]\d+)*(?!\s*つ)/g)) {
    out.add(m[0].replace(/,/g, ""));
  }
  return [...out].sort();
}

/**
 * 主張に含まれる固有名詞らしい語。ラテン文字の語のうち、大文字か数字を含むもの(サービス名・機能名・略語)。
 * 小文字だけの一般語は数えない。
 */
export function extractTerms(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.normalize("NFKC").matchAll(/[A-Za-z][A-Za-z0-9.+_-]*/g)) {
    const token = m[0].replace(/[.+_-]+$/, "");
    if (token.length >= 2 && /[A-Z0-9]/.test(token)) out.add(token.toLowerCase());
  }
  return [...out].sort();
}

export interface SourceState {
  contentHash: string | null;
  status: string;
}

/**
 * 根拠 1 件の照合。quote は、エージェントが書いた引用。source は台帳の出典(なければ undefined)、body はその本文(キャッシュにあれば)。
 * 通れば空の配列、通らなければ理由コード(重複なし)を返す。
 */
export function checkGrounding(
  claim: string,
  evidence: Evidence,
  quote: string,
  source: SourceState | undefined,
  body: string | null,
): GroundingReason[] {
  if (source === undefined || source.status !== "active") return ["source-not-active"];
  if (source.contentHash !== evidence.contentHash) return ["hash-mismatch"];
  if (body === null) return ["body-not-cached"];
  const section = findSection(body, evidence.anchor.heading);
  if (section === null) return ["anchor-not-found"];

  const reasons: GroundingReason[] = [];
  const range = section.text;
  if (!compact(range).includes(compact(quote))) reasons.push("quote-not-found");
  const rangeNumbers = new Set(extractNumbers(range));
  if (extractNumbers(claim).some((n) => !rangeNumbers.has(n))) reasons.push("number-mismatch");
  const lowered = normalize(range);
  if (extractTerms(claim).some((t) => !lowered.includes(t))) reasons.push("term-not-found");
  return reasons;
}
