import type { LedgerFile, SourceEntry, SourceStatus } from "./ledger.ts";

/**
 * 出典の本文の変化の検知(ADR 0006・0008)。今回の取得の結果を、台帳の前回のハッシュと比べる。
 * 報告には URL、前回と今回の取得日、状態だけを載せ、本文は載せない。
 */

/** 今回の取得の結果。取得できたものはハッシュ、できなかったものは null */
export interface Observation {
  url: string;
  hash: string | null;
  fetchedAt: string;
  status: SourceStatus;
}

export interface ChangeRow {
  url: string;
  previousFetchedAt: string | null;
  fetchedAt: string;
  status: SourceStatus;
}

export interface ChangeReport {
  /** 本文が変わった出典(前回のハッシュがあり、今回と異なる) */
  changed: ChangeRow[];
  /** 取得できず、変化を確かめられない出典(リンク切れなど) */
  unconfirmed: ChangeRow[];
}

export function detectChanges(previous: readonly SourceEntry[], observations: readonly Observation[]): ChangeReport {
  const byUrl = new Map(previous.map((s) => [s.url, s]));
  const report: ChangeReport = { changed: [], unconfirmed: [] };
  for (const o of observations) {
    const before = byUrl.get(o.url);
    const row = { url: o.url, previousFetchedAt: before?.fetchedAt ?? null, fetchedAt: o.fetchedAt, status: o.status };
    if (o.hash === null) report.unconfirmed.push(row);
    else if (before?.contentHash != null && before.contentHash !== o.hash) report.changed.push(row);
  }
  return report;
}

/**
 * 問題の来歴: 問題の ID ごとに、根拠にした事実カードの ID。来歴は pipeline の側に置く(ADR 0008)。
 */
export type Provenance = Readonly<Record<string, readonly string[]>>;

export interface Affected {
  facts: string[];
  questions: string[];
}

/**
 * 変化した出典に結びつく事実カードと、その事実カードを根拠にする問題を、台帳と来歴をたどって洗い出す。
 * factSources は、事実カードの ID ごとの、根拠にした出典の URL(事実カードの台帳から作る)。
 */
export function traceAffected(
  ledger: LedgerFile,
  changedUrls: readonly string[],
  provenance: Provenance,
  factSources: Readonly<Record<string, readonly string[]>> = {},
): Affected {
  const changed = new Set(changedUrls);
  const facts = new Set<string>();
  for (const source of ledger.sources) {
    if (!changed.has(source.url)) continue;
    for (const claim of source.claims) for (const f of claim.factRefs) facts.add(f);
  }
  for (const [id, urls] of Object.entries(factSources)) {
    if (urls.some((u) => changed.has(u))) facts.add(id);
  }
  const questions = Object.entries(provenance)
    .filter(([, refs]) => refs.some((f) => facts.has(f)))
    .map(([id]) => id);
  return { facts: [...facts].sort(), questions: questions.sort() };
}

/** 洗い出したものに「再検証が必要」の印を付ける(既存の印は残す) */
export function markRecheck(ledger: LedgerFile, affected: Affected): LedgerFile {
  return {
    ...ledger,
    recheck: {
      facts: [...new Set([...ledger.recheck.facts, ...affected.facts])].sort(),
      questions: [...new Set([...ledger.recheck.questions, ...affected.questions])].sort(),
    },
  };
}

/** 再検証が済んだものの印を外す */
export function clearRecheck(ledger: LedgerFile, done: Partial<Affected>): LedgerFile {
  const facts = new Set(done.facts ?? []);
  const questions = new Set(done.questions ?? []);
  return {
    ...ledger,
    recheck: {
      facts: ledger.recheck.facts.filter((f) => !facts.has(f)),
      questions: ledger.recheck.questions.filter((q) => !questions.has(q)),
    },
  };
}

/** 先の段階へ進めてよいか。再検証の印が付いた事実カード・問題は、済むまで止める */
export function isBlockedForRecheck(ledger: LedgerFile, item: { fact?: string; question?: string }): boolean {
  return (
    (item.fact !== undefined && ledger.recheck.facts.includes(item.fact)) ||
    (item.question !== undefined && ledger.recheck.questions.includes(item.question))
  );
}
