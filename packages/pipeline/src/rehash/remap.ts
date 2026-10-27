import type { LedgerFile } from "../collect/ledger.ts";
import type { DecisionsFile } from "../decisions/decisions.ts";
import type { ProvenanceFile } from "../draft/provenance.ts";
import type { FactsFile } from "../facts/schema.ts";

/**
 * 出典の本文のハッシュを持つ記録(台帳、事実カード、来歴、判断の記録)を、1 つの走査で読み書きする。
 * 変える関数 `map(url, hash)` が、記録のハッシュごとに呼ばれ、返した値に置き換わる。
 * 旧い 2 つのハッシュが同じ新しいハッシュになると、同じ項目が重なるので、内容が完全に同じ項目は 1 つにまとめる。
 */

export interface HashedFiles {
  ledger: LedgerFile;
  facts: FactsFile;
  provenance: ProvenanceFile;
  decisions: DecisionsFile;
}

export type HashMap = (url: string, hash: string) => string;

/** 内容が完全に同じ項目を 1 つにまとめる(最初のものを残し、並びは変えない) */
function distinct<T>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function remapHashes(files: HashedFiles, map: HashMap): HashedFiles {
  const { ledger, facts, provenance, decisions } = files;
  return {
    ledger: {
      ...ledger,
      sources: ledger.sources.map((s) =>
        s.contentHash === null ? s : { ...s, contentHash: map(s.url, s.contentHash) },
      ),
      guide:
        ledger.guide === null
          ? null
          : {
              ...ledger.guide,
              contentHash: map(ledger.guide.sourceUrl, ledger.guide.contentHash),
              pages: distinct(ledger.guide.pages.map((p) => ({ ...p, contentHash: map(p.url, p.contentHash) }))),
            },
    },
    facts: {
      ...facts,
      extracted: distinct(facts.extracted.map((e) => ({ ...e, contentHash: map(e.url, e.contentHash) }))),
      cards: facts.cards.map((c) => ({
        ...c,
        sources: distinct(c.sources.map((s) => ({ ...s, contentHash: map(s.url, s.contentHash) }))),
      })),
    },
    provenance: {
      ...provenance,
      entries: provenance.entries.map((e) => ({
        ...e,
        sources: distinct(e.sources.map((s) => ({ ...s, contentHash: map(s.url, s.contentHash) }))),
      })),
    },
    decisions: {
      ...decisions,
      decisions: distinct(
        decisions.decisions.map((d) => (d.target === "source" ? { ...d, contentHash: map(d.url, d.contentHash) } : d)),
      ),
    },
  };
}

/** 記録にあるハッシュの組(URL と旧いハッシュ)を、重ならないように集める */
export function hashPairs(files: HashedFiles): { url: string; hash: string }[] {
  const seen = new Map<string, { url: string; hash: string }>();
  remapHashes(files, (url, hash) => {
    seen.set(`${url} ${hash}`, { url, hash });
    return hash;
  });
  return [...seen.values()];
}

/** 台帳が今の本文として持つハッシュの組(出典と、試験ガイドの記録) */
export function currentPairs(ledger: LedgerFile): { url: string; hash: string }[] {
  const pairs: { url: string; hash: string }[] = [];
  for (const s of ledger.sources) if (s.contentHash !== null) pairs.push({ url: s.url, hash: s.contentHash });
  if (ledger.guide !== null) {
    pairs.push({ url: ledger.guide.sourceUrl, hash: ledger.guide.contentHash });
    for (const p of ledger.guide.pages) pairs.push({ url: p.url, hash: p.contentHash });
  }
  return pairs;
}
