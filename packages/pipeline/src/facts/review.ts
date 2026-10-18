import type { FactCard } from "./schema.ts";

/**
 * 人が事実カードの品質を抜き取りで確かめるためのレビューレポート。
 * 件数、分野別、理由の種類ごとの件数、抜き取りの表だけを持つ。取得した本文や、本文の長い写しは含めない。
 */

export interface SampleRow {
  id: string;
  domain: string;
  url: string;
  section: string;
  /** アンカーの見出し(ID または見出しの文) */
  anchor: string;
  /** 出典がほかにいくつあるか */
  moreSources: number;
  edition: string | null;
  region: string | null;
}

export interface ReviewReport {
  examCode: string;
  counts: { total: number; passed: number; held: number; rejected: number };
  byDomain: { domain: string; passed: number; held: number; rejected: number }[];
  /** 保留・不採用の理由コードごとの件数 */
  byReason: { reason: string; count: number }[];
  seed: number;
  perDomain: number;
  samples: SampleRow[];
}

/** 乱数の種から決まる乱数列(mulberry32)。同じ種なら同じ並びになる */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) as number), 16777619);
  return h >>> 0;
}

/** 通過したカードから、分野ごとに最大 perDomain 件を選ぶ。分野の中の並びは種で決まるので、再現できる */
export function sampleCards(cards: readonly FactCard[], seed: number, perDomain: number): FactCard[] {
  const domains = [...new Set(cards.filter((c) => c.status === "passed").map((c) => c.domain))].sort();
  const picked: FactCard[] = [];
  for (const domain of domains) {
    const pool = cards
      .filter((c) => c.status === "passed" && c.domain === domain)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const random = seededRandom(seed ^ hashString(domain));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j] as FactCard, pool[i] as FactCard];
    }
    picked.push(...pool.slice(0, perDomain).sort((a, b) => (a.id < b.id ? -1 : 1)));
  }
  return picked;
}

export function buildReview(
  examCode: string,
  cards: readonly FactCard[],
  domains: readonly string[],
  seed: number,
  perDomain: number,
): ReviewReport {
  const count = (status: FactCard["status"]) => cards.filter((c) => c.status === status).length;
  const reasons = new Map<string, number>();
  for (const c of cards) for (const r of c.reasons) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  return {
    examCode,
    counts: { total: cards.length, passed: count("passed"), held: count("held"), rejected: count("rejected") },
    byDomain: domains.map((domain) => {
      const inDomain = cards.filter((c) => c.domain === domain);
      const n = (status: FactCard["status"]) => inDomain.filter((c) => c.status === status).length;
      return { domain, passed: n("passed"), held: n("held"), rejected: n("rejected") };
    }),
    byReason: [...reasons.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([reason, n]) => ({ reason, count: n })),
    seed,
    perDomain,
    samples: sampleCards(cards, seed, perDomain).map((c) => {
      const first = c.sources[0] as FactCard["sources"][number];
      return {
        id: c.id,
        domain: c.domain,
        url: first.url,
        section: first.section,
        anchor: first.anchor.heading,
        moreSources: c.sources.length - 1,
        edition: c.scope.edition ?? null,
        region: c.scope.region ?? null,
      };
    }),
  };
}

/** 人が読む形(Markdown の表)にする */
export function renderReview(report: ReviewReport): string {
  const cell = (v: string | number | null) => String(v ?? "-").replace(/\|/g, "\\|");
  const lines = [
    `# 事実カードのレビュー(${report.examCode})`,
    "",
    `件数: 全体 ${report.counts.total}、通過 ${report.counts.passed}、保留 ${report.counts.held}、不採用 ${report.counts.rejected}`,
    "",
    "## 分野別",
    "",
    "| 分野 | 通過 | 保留 | 不採用 |",
    "| --- | --- | --- | --- |",
    ...report.byDomain.map((d) => `| ${cell(d.domain)} | ${d.passed} | ${d.held} | ${d.rejected} |`),
    "",
    "## 保留・不採用の理由",
    "",
    "| 理由コード | 件数 |",
    "| --- | --- |",
    ...report.byReason.map((r) => `| ${cell(r.reason)} | ${r.count} |`),
    "",
    `## 抜き取り(種 ${report.seed}、分野ごとに最大 ${report.perDomain} 件)`,
    "",
    "| カード | 分野 | 出典 | 節 | アンカー | ほかの出典 | 版 | リージョン |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.samples.map(
      (s) =>
        `| ${cell(s.id)} | ${cell(s.domain)} | ${cell(s.url)} | ${cell(s.section)} | ${cell(s.anchor)} | ${s.moreSources} | ${cell(s.edition)} | ${cell(s.region)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

/** Markdown の表の 1 マスに入れる。縦棒と改行を、表を壊さない形にする */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/**
 * 人が通過・保留の事実カードをすべて確かめるための表。主張(出典の言い換え)、根拠の節、出典の URL、版・リージョン、確度、状態、理由コードを載せる。
 * 取得した本文の写しは載せない。
 */
export function renderCardTable(
  examCode: string,
  cards: readonly FactCard[],
  /** 抜き取りで確認しないと決めた通過のカードの ID。表に出さない(保留のカードは、全件を出す) */
  skipped: ReadonlySet<string> = new Set(),
): string {
  const rows = cards.filter((c) => c.status !== "rejected" && !skipped.has(c.id));
  const lines = [
    `# 事実カードの一覧(通過・保留、${examCode})`,
    "",
    `${skipped.size > 0 ? `抜き取りで確認するカードと、保留のカード ${rows.length} 件(確認しない通過のカード ${skipped.size} 件は載せない)。` : `通過と保留のカード ${rows.length} 件。`}保留を解く・却下するときは、人の判断の記録に書く。`,
    "",
    "| ID | 分野 | 主張 | 根拠の節 | 出典 | 版 | リージョン | 確度 | 状態 | 理由 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const c of rows) {
    const source = c.sources[0];
    lines.push(
      `| ${c.id} | ${c.domain} | ${cell(c.claim)} | ${cell(source?.section ?? "-")} | ${cell(c.sources.map((s) => s.url).join(" "))} | ${c.scope.edition ?? "-"} | ${c.scope.region ?? "-"} | ${c.confidence} | ${c.status} | ${c.reasons.join(", ") || "-"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
