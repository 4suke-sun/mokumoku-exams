import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sha256 } from "../collect/fetcher.ts";
import type { Config } from "../config.ts";
import { type UnpublishedFile, UnpublishedFileSchema } from "../contract.ts";
import type { FactsFile } from "../facts/schema.ts";
import { contentHash, inputFromQuestion } from "../judge/input.ts";
import { type DraftRecord, HUMAN_REJECTED } from "./store.ts";

/**
 * 非公開の問題の書き直し(draft --rewrite。ADR 0023)。非公開のファイルの問題で、判定が「書き直しで復帰できる」ものを、
 * 判定の理由コードと、元の根拠の事実カード・周辺の事実カードを材料に、ブラッシュアップ役(question-reviser)が書き直す。
 * 書き直した下書きは、問題の ID を引き継ぐ(rewriteOf)。下書きと同じ取り込み・検証を通り、判定が公開になれば、restore で公開へ戻る。
 */

type Entry = UnpublishedFile["entries"][number];

/** 書き直せる問題。選択式で、判定が rewritable のもの */
export interface RewriteTarget {
  entry: Entry;
  /** 非公開の問題の本文のハッシュ(判定の内容のハッシュと同じ)。本文が変わると依頼の鍵が変わる */
  contentHash: string;
  /** この問題の書き直しの下書きのうち、人が却下したものの数 */
  round: number;
}

/**
 * 書き直しの対象: 非公開のファイルの、判定が rewritable の選択式の問題で、書き直しの下書きが生きていない(不採用でない)もの。
 * 人が却下した書き直しの下書きは本文を持たないので、その問題は、新しい依頼で書き直せる(人の却下の数 round が増えて、依頼の鍵が変わる)。
 * 取り込みの検査で不採用になった下書きは、同じ入力では依頼し直さない(取り込み済みの鍵)。入力(定義・事実カード・本文)が変わったときだけ、鍵が変わって依頼される。
 * 判定は、非公開のファイルに記録した verdict を使う(判定の結果のファイルは、非公開の問題の判定を持たない)。
 */
export function rewriteTargets(unpublished: UnpublishedFile | null, drafts: readonly DraftRecord[]): RewriteTarget[] {
  const out: RewriteTarget[] = [];
  for (const entry of unpublished?.entries ?? []) {
    if (entry.verdict !== "rewritable") continue;
    const input = inputFromQuestion(entry.question);
    if (input === null) continue;
    const id = entry.question.questionId;
    const mine = drafts.filter((d) => d.rewriteOf === id);
    if (mine.some((d) => d.status !== "rejected")) continue;
    out.push({
      entry,
      contentHash: contentHash(input),
      round: mine.filter((d) => d.reasons.includes(HUMAN_REJECTED)).length,
    });
  }
  return out.sort((a, b) => (a.entry.question.questionId < b.entry.question.questionId ? -1 : 1));
}

/** 非公開のファイル(data/unpublished.<コード>.json)を読む。なければ null。形が違えば "invalid" */
export function readUnpublished(config: Config, rootDir: string, examCode: string): UnpublishedFile | null | "invalid" {
  const file = resolve(rootDir, dirname(config.examsFile), `unpublished.${examCode.toLowerCase()}.json`);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "invalid";
  }
  const parsed = UnpublishedFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : "invalid";
}

/** 書き直しの下書きの、計画の項目の ID。問題の ID から決まる(書き直しは計画の項目を持たない) */
export function rewritePlanItemId(questionId: string): string {
  return `p-${sha256(Buffer.from(`rewrite\n${questionId}`)).slice(0, 12)}`;
}

/** 内容が同じであることの比較に使う、問題の分野・出典の URL・論点 */
export interface ContentIdentity {
  domain: string;
  /** 出典の URL(重複なし、昇順) */
  referenceUrls: string[];
  /** 論点: 根拠の事実カードの、分野と出題範囲の項目の組(重複なし、昇順) */
  topics: string[];
}

const unique = (values: readonly string[]): string[] => [...new Set(values)].sort();

/** 根拠の事実カードの ID から、論点(分野と出題範囲の項目の組)を求める。カードがなければ飛ばす */
export function topicsOf(factIds: readonly string[], facts: FactsFile): string[] {
  return unique(
    factIds.flatMap((id) => {
      const card = facts.cards.find((c) => c.id === id);
      return card === undefined ? [] : card.scopeItems.map((n) => `${card.domain}#${n}`);
    }),
  );
}

export function identityOf(input: {
  domain: string;
  referenceUrls: readonly string[];
  topics: readonly string[];
}): ContentIdentity {
  return { domain: input.domain, referenceUrls: unique(input.referenceUrls), topics: unique(input.topics) };
}

/**
 * 書き直した問題が、元の問題と同じ内容かを、機械で比べる。違うものは、理由コード(`rewrite:<項目>-changed`)で返す。
 * 分野・出典の URL・論点が、すべて同じであること(ADR 0023)。基準を満たすことと、検証役を通ることは、別の段階で確かめる。
 */
export function sameContentProblems(original: ContentIdentity, rewritten: ContentIdentity): string[] {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
  const problems: string[] = [];
  if (original.domain !== rewritten.domain) problems.push("rewrite:domain-changed");
  if (!same(original.referenceUrls, rewritten.referenceUrls)) problems.push("rewrite:references-changed");
  if (!same(original.topics, rewritten.topics)) problems.push("rewrite:topic-changed");
  return problems;
}
