import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { REASON, SHA256 } from "../collect/ledger.ts";
import { EXAM_CODE, sourceUrlReason } from "../contract.ts";
import { FACT_ID } from "../draft/schema.ts";
import { PathsError } from "../shared/errors.ts";
import { writeFileAtomic } from "../shared/fs.ts";

/**
 * 人の判断の記録。資格ごとに 1 つの JSON をコミットし、各段階が読む。
 * 持つのは、対象(ID か、出典の URL と本文のハッシュ)、判断、理由コードだけ。誰が判断したかは持たない。
 * 事実カードと下書きの ID は内容から決まるので、同じ内容を作り直すと判断が引き継がれ、内容が変わると引き継がれない。
 */

export const DRAFT_ID = z.string().regex(/^d-[0-9a-f]{12}$/);

/** 出典: 日付が古いだけで止まった出典を、記録した本文のハッシュと同じ間だけ受け入れる */
const SourceDecisionSchema = z.strictObject({
  target: z.literal("source"),
  url: z
    .string()
    .max(2000)
    .refine((u) => sourceUrlReason(u) === null, "出典に使えない URL"),
  contentHash: SHA256,
  decision: z.literal("accept"),
  reason: REASON,
});

/** 事実カード: 保留の解除(release)と却下(reject) */
const FactDecisionSchema = z.strictObject({
  target: z.literal("fact"),
  id: FACT_ID,
  decision: z.enum(["release", "reject"]),
  reason: REASON,
});

/** 下書き: 承認(approve)、保留の解除(release)、却下(reject) */
const DraftDecisionSchema = z.strictObject({
  target: z.literal("draft"),
  id: DRAFT_ID,
  decision: z.enum(["approve", "release", "reject"]),
  reason: REASON,
});

export const DecisionSchema = z.discriminatedUnion("target", [
  SourceDecisionSchema,
  FactDecisionSchema,
  DraftDecisionSchema,
]);

export const DecisionsFileSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  decisions: z.array(DecisionSchema),
});

export type Decision = z.infer<typeof DecisionSchema>;
export type DecisionsFile = z.infer<typeof DecisionsFileSchema>;
export type FactDecision = z.infer<typeof FactDecisionSchema>["decision"];
export type DraftDecision = z.infer<typeof DraftDecisionSchema>["decision"];

/** 記録の読み込みの誤り。場所(項目のパス)だけを持ち、値は持たない */
export class DecisionsError extends PathsError {
  constructor(paths: string[]) {
    super("判断の記録の誤り", paths);
  }
}

export function emptyDecisions(examCode: string): DecisionsFile {
  return { examCode, decisions: [] };
}

export function decisionsPath(dir: string, examCode: string): string {
  return join(dir, `${examCode.toLowerCase()}.json`);
}

/** 判断の対象の鍵。同じ対象には、判断を 1 件だけ持つ */
export function targetKey(d: Decision): string {
  return d.target === "source" ? `source ${d.url} ${d.contentHash}` : `${d.target} ${d.id}`;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function parseDecisions(raw: unknown): DecisionsFile {
  const parsed = DecisionsFileSchema.safeParse(raw);
  if (!parsed.success) throw new DecisionsError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const keys = parsed.data.decisions.map(targetKey);
  const dup = keys.findIndex((k, i) => keys.indexOf(k) !== i);
  if (dup >= 0) throw new DecisionsError([`decisions.${dup}`]);
  return parsed.data;
}

export function readDecisions(path: string, examCode: string): DecisionsFile {
  if (!existsSync(path)) return emptyDecisions(examCode);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new DecisionsError(["(JSON の形)"]);
  }
  const file = parseDecisions(raw);
  if (file.examCode !== examCode) throw new DecisionsError(["examCode"]);
  return file;
}

/** 書く。対象の鍵の順に並べ、一時ファイルに書いてから置き換える */
export function writeDecisions(path: string, file: DecisionsFile): void {
  const sorted = { ...file, decisions: [...file.decisions].sort((a, b) => byString(targetKey(a), targetKey(b))) };
  const text = `${JSON.stringify(parseDecisions(sorted), null, 2)}\n`;
  writeFileAtomic(path, text);
}

/** 判断を足す。同じ対象の判断は、新しいもので置き換える */
export function upsertDecisions(file: DecisionsFile, incoming: readonly Decision[]): DecisionsFile {
  const byKey = new Map(file.decisions.map((d) => [targetKey(d), d]));
  for (const d of incoming) byKey.set(targetKey(d), d);
  return { ...file, decisions: [...byKey.values()] };
}

/** 事実カードの判断。なければ undefined */
export function factDecision(file: DecisionsFile, id: string): FactDecision | undefined {
  const d = file.decisions.find((x) => x.target === "fact" && x.id === id);
  return d?.target === "fact" ? d.decision : undefined;
}

/** 下書きの判断。なければ undefined */
export function draftDecision(file: DecisionsFile, id: string): DraftDecision | undefined {
  const d = file.decisions.find((x) => x.target === "draft" && x.id === id);
  return d?.target === "draft" ? d.decision : undefined;
}

/** 出典を受け入れているか。記録した本文のハッシュと同じときだけ */
export function sourceAccepted(file: DecisionsFile, url: string, contentHash: string | null): boolean {
  return (
    contentHash !== null &&
    file.decisions.some((d) => d.target === "source" && d.url === url && d.contentHash === contentHash)
  );
}

/**
 * 対象がなくなった判断(カードや下書きが消えた、作り直されて ID が変わった、出典の本文が変わった)。
 * 黙って捨てずに報告するため、鍵だけを返す(値は返さない)。
 */
export function orphanDecisions(
  file: DecisionsFile,
  known: {
    factIds?: readonly string[];
    draftIds?: readonly string[];
    sources?: readonly { url: string; contentHash: string | null }[];
  },
): Decision[] {
  const facts = known.factIds ? new Set(known.factIds) : null;
  const drafts = known.draftIds ? new Set(known.draftIds) : null;
  return file.decisions.filter((d) => {
    if (d.target === "fact") return facts !== null && !facts.has(d.id);
    if (d.target === "draft") return drafts !== null && !drafts.has(d.id);
    return (
      known.sources !== undefined && !known.sources.some((s) => s.url === d.url && s.contentHash === d.contentHash)
    );
  });
}
