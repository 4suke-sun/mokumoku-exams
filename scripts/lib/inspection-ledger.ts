import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Kind = "mechanical" | "inspector" | "inspector-deep";
export type Verdict = "OK" | "WARN" | "BLOCK";

/** 台帳の 1 件。差分の内容や、検査で見つけた値は持たない。 */
export interface LedgerEntry {
  patchId: string;
  kind: Kind;
  verdict: Verdict;
  /** 検査の基準(チェックリスト・検査役の定義・機械検査・拒否リスト)のハッシュ。変わったら、記録を使わない。 */
  rules: string;
}

export interface Ledger {
  entries: LedgerEntry[];
}

export const KINDS: Kind[] = ["mechanical", "inspector", "inspector-deep"];
export const VERDICTS: Verdict[] = ["OK", "WARN", "BLOCK"];

/** 検査の仕組みそのものを変える差分。inspector-deep を併用する。 */
export const DEEP_PATHS = /^(scripts\/|\.githooks\/|\.github\/workflows\/|\.claude\/)/;
/** 差分の本文が「Binary files … differ」だけになり、patch-id が内容を区別できないことがある。 */
export const BINARY_DIFF = /^(Binary files .* differ|GIT binary patch)$/m;

const RULE_FILES = [
  ".claude/skills/dev-commit/checklist.md",
  ".claude/skills/dev-commit/inspector-rules.md",
  ".claude/agents/inspector.md",
  ".claude/agents/inspector-deep.md",
  "scripts/lib/pr-secrets-check.ts",
  "scripts/lib/git-check.ts",
  "scripts/lib/image-metadata-check.ts",
  "scripts/lib/local-denylist.ts",
];

const LEDGER_FILE = "mokumoku-inspection-ledger.json";

/** 台帳に使える差分か。バイナリの変更を含む差分は、毎回読む。 */
export function isReusable(diffText: string): boolean {
  return !BINARY_DIFF.test(diffText);
}

/** 差分のファイル一覧から、記録があれば読み直さない検査の種類を返す。 */
export function requiredKinds(files: string[]): Kind[] {
  return files.some((f) => DEEP_PATHS.test(f)) ? ["inspector", "inspector-deep"] : ["inspector"];
}

/** 台帳の 1 件の検査。書き込み(writeLedger)と読み込み(parseLedger)の両方で使う。 */
function isLedgerEntry(e: unknown): e is LedgerEntry {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as LedgerEntry).patchId === "string" &&
    KINDS.includes((e as LedgerEntry).kind) &&
    VERDICTS.includes((e as LedgerEntry).verdict) &&
    typeof (e as LedgerEntry).rules === "string"
  );
}

export function parseLedger(text: string): Ledger {
  try {
    const parsed = JSON.parse(text) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries.filter(isLedgerEntry) };
  } catch {
    return { entries: [] };
  }
}

/** 同じ差分・同じ種類の記録は、置き換える。 */
export function addEntries(ledger: Ledger, added: LedgerEntry[]): Ledger {
  const same = (a: LedgerEntry, b: LedgerEntry) => a.patchId === b.patchId && a.kind === b.kind;
  return { entries: [...ledger.entries.filter((e) => !added.some((a) => same(a, e))), ...added] };
}

/**
 * 差分の検査が済んでいて、読み直さなくてよいか。必要な種類の全部に、同じ基準での OK の記録があること。
 * 判定が WARN だった差分は、読み直す。
 */
export function isCovered(ledger: Ledger, patchId: string, kinds: Kind[], rules: string): boolean {
  return kinds.every((kind) =>
    ledger.entries.some((e) => e.patchId === patchId && e.kind === kind && e.rules === rules && e.verdict === "OK"),
  );
}

export function patchIdOf(diffText: string): string | null {
  if (diffText.trim() === "") return null;
  const out = execFileSync("git", ["patch-id", "--stable"], { input: diffText, encoding: "utf8" });
  return out.split(" ")[0]?.trim() || null;
}

/** 検査の基準のハッシュ。ファイルの内容だけを見る(拒否リストの語は、ハッシュにして持つ)。 */
export function rulesHash(root: string, denylistPaths: string[]): string {
  const hash = createHash("sha256");
  for (const file of [...RULE_FILES.map((f) => join(root, f)), ...denylistPaths]) {
    hash.update(`${existsSync(file) ? readFileSync(file, "utf8") : ""}\u0000`);
  }
  return hash.digest("hex");
}

/** 台帳は .git の下に置く。追跡されず、すべての作業ツリーから同じものを読める。 */
export function ledgerPath(gitCommonDir: string): string {
  return join(gitCommonDir, LEDGER_FILE);
}

export function readLedger(path: string): Ledger {
  return existsSync(path) ? parseLedger(readFileSync(path, "utf8")) : { entries: [] };
}

/** 台帳を文字列にする。読み込み(parseLedger)と同じ検査に通らない記録があれば、書かずに例外にする(読み込みで黙って落ちる記録を作らない)。 */
export function serializeLedger(ledger: Ledger): string {
  if (!ledger.entries.every(isLedgerEntry)) throw new Error("台帳の記録の形が合わない");
  return `${JSON.stringify(ledger, null, 2)}\n`;
}

export function writeLedger(path: string, ledger: Ledger): void {
  writeFileSync(path, serializeLedger(ledger));
}
