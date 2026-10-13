import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { ISO_DATE, type LedgerFile, SHA256 } from "../collect/ledger.ts";
import { EXAM_CODE, hostAllowedForVendor, sourceUrlReason } from "../contract.ts";
import type { FactsFile } from "../facts/schema.ts";
import { FACT_ID } from "./schema.ts";
import type { DraftRecord } from "./store.ts";

/**
 * 問題の来歴(ADR 0008)。下書きごとに、根拠の事実カードと出典(URL、取得日、本文のハッシュ)を結ぶ。
 * 資格ごとに 1 つの JSON をコミットする。持つのは ID、リンク、日付、ハッシュだけで、本文や言い換えは持たない。
 * 公開データ(data/)には載せない。来歴のない下書きは、検証の段階へ進めない。
 */

export const ProvenanceSourceSchema = z.strictObject({
  /** 出典の URL。許可したドメインの https の URL であることは、検査(checkProvenance)で確かめる */
  url: z.string().max(2000),
  fetchedAt: ISO_DATE,
  contentHash: SHA256,
});

export const ProvenanceEntrySchema = z.strictObject({
  /** 下書きの識別子。書き出しのあと、公開した問題の ID は questionId に記録する */
  draftId: z.string().regex(/^d-[0-9a-f]{12}$/),
  questionId: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,15}-\d{4}$/)
    .optional(),
  factIds: z.array(FACT_ID).min(1).max(10),
  sources: z.array(ProvenanceSourceSchema).min(1).max(10),
});

export const ProvenanceFileSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  entries: z.array(ProvenanceEntrySchema),
});

export type ProvenanceEntry = z.infer<typeof ProvenanceEntrySchema>;
export type ProvenanceFile = z.infer<typeof ProvenanceFileSchema>;

/** 来歴の読み込みの誤り。場所(項目のパス)だけを持ち、値は持たない */
export class ProvenanceError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super("来歴の誤り");
    this.paths = paths;
  }
}

export function emptyProvenance(examCode: string): ProvenanceFile {
  return { examCode, entries: [] };
}

export function provenancePath(dir: string, examCode: string): string {
  return join(dir, `${examCode.toLowerCase()}.json`);
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 並びを固定する。項目は下書きの ID 順、根拠は URL 順、事実カードの ID は昇順で重複なし */
export function normalizeProvenance(file: ProvenanceFile): ProvenanceFile {
  return {
    ...file,
    entries: [...file.entries]
      .sort((a, b) => byString(a.draftId, b.draftId))
      .map((e) => ({
        ...e,
        factIds: [...new Set(e.factIds)].sort(byString),
        sources: [...e.sources].sort((a, b) => byString(`${a.url} ${a.contentHash}`, `${b.url} ${b.contentHash}`)),
      })),
  };
}

export function parseProvenance(raw: unknown): ProvenanceFile {
  const parsed = ProvenanceFileSchema.safeParse(raw);
  if (!parsed.success) throw new ProvenanceError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const ids = parsed.data.entries.map((e) => e.draftId);
  const dup = ids.findIndex((id, i) => ids.indexOf(id) !== i);
  if (dup >= 0) throw new ProvenanceError([`entries.${dup}.draftId`]);
  return parsed.data;
}

export function serializeProvenance(file: ProvenanceFile): string {
  return `${JSON.stringify(parseProvenance(normalizeProvenance(file)), null, 2)}\n`;
}

export function readProvenance(path: string, examCode: string): ProvenanceFile {
  if (!existsSync(path)) return emptyProvenance(examCode);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ProvenanceError(["(JSON の形)"]);
  }
  const file = parseProvenance(raw);
  if (file.examCode !== examCode) throw new ProvenanceError(["examCode"]);
  return file;
}

export function writeProvenance(path: string, file: ProvenanceFile): void {
  const text = serializeProvenance(file);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** 来歴の項目を作る。作れない理由があれば、理由コードを返す */
export function buildEntry(
  draftId: string,
  factIds: readonly string[],
  facts: FactsFile,
  ledger: LedgerFile,
): { entry: ProvenanceEntry } | { reasons: string[] } {
  const reasons = new Set<string>();
  const sources = new Map<string, ProvenanceEntry["sources"][number]>();
  for (const id of new Set(factIds)) {
    const card = facts.cards.find((c) => c.id === id);
    if (card === undefined) {
      reasons.add("fact-not-found");
      continue;
    }
    if (card.status !== "passed") reasons.add("fact-not-passed");
    for (const evidence of card.sources) {
      const fetchedAt = ledger.sources.find((s) => s.url === evidence.url)?.fetchedAt ?? null;
      if (fetchedAt === null) {
        reasons.add("source-not-in-ledger");
        continue;
      }
      sources.set(`${evidence.url} ${evidence.contentHash}`, {
        url: evidence.url,
        fetchedAt,
        contentHash: evidence.contentHash,
      });
    }
  }
  if (reasons.size > 0) return { reasons: [...reasons].sort() };
  return {
    entry: {
      draftId,
      factIds: [...new Set(factIds)].sort(byString),
      sources: [...sources.values()].sort((a, b) => byString(a.url, b.url)).slice(0, 10),
    },
  };
}

export interface ProvenanceProblem {
  draftId: string;
  code: string;
}

/**
 * 来歴の検査。事実カードが存在して通過していること、出典が許可したドメインの https の URL で、
 * その資格のベンダーの出典であること、出典が根拠の事実カードのものであること。
 */
export function checkProvenance(file: ProvenanceFile, facts: FactsFile, vendor: string): ProvenanceProblem[] {
  const problems: ProvenanceProblem[] = [];
  for (const entry of file.entries) {
    const add = (code: string) => {
      if (!problems.some((p) => p.draftId === entry.draftId && p.code === code)) {
        problems.push({ draftId: entry.draftId, code });
      }
    };
    const cited = entry.factIds.map((id) => facts.cards.find((c) => c.id === id));
    for (const card of cited) {
      if (card === undefined) add("fact-not-found");
      else if (card.status !== "passed") add("fact-not-passed");
    }
    const citedUrls = new Set(cited.flatMap((c) => c?.sources.map((s) => s.url) ?? []));
    for (const source of entry.sources) {
      const reason = sourceUrlReason(source.url);
      if (reason !== null) {
        add(`source-url-${reason}`);
        continue;
      }
      if (!hostAllowedForVendor(new URL(source.url).hostname, vendor)) add("source-vendor-mismatch");
      if (!citedUrls.has(source.url)) add("source-not-from-facts");
    }
  }
  return problems;
}

/** 来歴のない下書きの ID。不採用でない下書きが対象。これが空でなければ、検証の段階へ進めない */
export function unprovenanced(drafts: readonly DraftRecord[], file: ProvenanceFile): string[] {
  const have = new Set(file.entries.map((e) => e.draftId));
  return drafts
    .filter((d) => d.status !== "rejected" && !have.has(d.id))
    .map((d) => d.id)
    .sort();
}
