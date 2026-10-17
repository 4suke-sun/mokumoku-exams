import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ISO_DATE, type LedgerFile, SHA256 } from "../collect/ledger.ts";
import { EXAM_CODE, hostAllowedForVendor, QUESTION_ID, sourceUrlReason } from "../contract.ts";
import type { FactsFile } from "../facts/schema.ts";
import { PathsError } from "../shared/errors.ts";
import { writeFileAtomic } from "../shared/fs.ts";
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
  questionId: z.string().regex(QUESTION_ID).optional(),
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
export class ProvenanceError extends PathsError {
  constructor(paths: string[]) {
    super("来歴の誤り", paths);
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
  writeFileAtomic(path, text);
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

/**
 * 再検証の検査(来歴と、台帳の今の状態を比べる)。下書き・問題の印は持たず、検査のたびに判定する。
 * - 根拠の事実カードに、再検証の印がある: recheck-fact
 * - 書き出した問題に、再検証の印がある: recheck-question
 * - 根拠の出典が台帳にない: source-not-in-ledger
 * - 根拠の出典の本文が、来歴を作ったときから変わった: source-changed
 * - 根拠の出典が active でない: 台帳の検査の、合格しなかった検査の名前ごとに source-check-<名前>(名前がなければ source-<状態>)
 */
export function checkRecheck(file: ProvenanceFile, ledger: LedgerFile): ProvenanceProblem[] {
  const problems: ProvenanceProblem[] = [];
  const recheckFacts = new Set(ledger.recheck.facts);
  const recheckQuestions = new Set(ledger.recheck.questions);
  for (const entry of file.entries) {
    const codes = new Set<string>();
    if (entry.factIds.some((id) => recheckFacts.has(id))) codes.add("recheck-fact");
    if (entry.questionId !== undefined && recheckQuestions.has(entry.questionId)) codes.add("recheck-question");
    for (const source of entry.sources) {
      for (const code of sourceProblems(ledger, source.url, source.contentHash)) codes.add(code);
    }
    for (const code of [...codes].sort()) problems.push({ draftId: entry.draftId, code });
  }
  return problems;
}

/** 事実カードを、下書きの根拠に使えるか。通過済みで、再検証の印がなく、根拠の出典がどれも active で本文が変わっていない */
export function usableFact(card: FactsFile["cards"][number], ledger: LedgerFile): boolean {
  return (
    card.status === "passed" &&
    !ledger.recheck.facts.includes(card.id) &&
    card.sources.every((s) => sourceProblems(ledger, s.url, s.contentHash).length === 0)
  );
}

/** 出典が、先の段階の根拠に使えない理由。使えるなら空 */
export function sourceProblems(ledger: LedgerFile, url: string, contentHash: string): string[] {
  const current = ledger.sources.find((s) => s.url === url);
  if (current === undefined) return ["source-not-in-ledger"];
  const codes: string[] = [];
  if (current.contentHash !== contentHash) codes.push("source-changed");
  if (current.status !== "active") {
    const failed = current.checks.filter((c) => c.result !== "pass").map((c) => `source-check-${c.name}`);
    codes.push(...(failed.length > 0 ? failed : [`source-${current.status}`]));
  }
  return codes;
}

/** 来歴のない下書きの ID。不採用でない下書きが対象。これが空でなければ、検証の段階へ進めない */
export function unprovenanced(drafts: readonly DraftRecord[], file: ProvenanceFile): string[] {
  const have = new Set(file.entries.map((e) => e.draftId));
  return drafts
    .filter((d) => d.status !== "rejected" && !have.has(d.id))
    .map((d) => d.id)
    .sort();
}
