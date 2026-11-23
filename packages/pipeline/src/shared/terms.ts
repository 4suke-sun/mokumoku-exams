import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PathsError } from "./errors.ts";

/**
 * 用語の辞書。ベンダーごとの文書(`docs/exam-style/<ベンダー>-terms.md`)の表を読む。
 * 作問役・書き直し役は、この文書を指針(`styleGuides`)として読み、判定の基準には使う語・使わない語の対を足し、
 * 取り込みの検査(`avoid-term`・`abbr-first-use`)が同じ表を使う。表が定義元で、ほかの場所に写さない。
 */

export interface AvoidEntry {
  /** 使う語 */
  use: string;
  /** 使わない語(使う語の別の訳。一致したら止める) */
  avoid: string[];
  /** 使わない語を含むが、別の意味の語。検査の前に除く */
  exempt: string[];
  /** どのとき使うか(人が読む) */
  note: string;
}

export interface AbbreviationPair {
  abbr: string;
  full: string;
}

export interface Terms {
  vendor: string;
  entries: AvoidEntry[];
  /** 初出で、「略語(正式名称)」の形にする略語 */
  pairs: AbbreviationPair[];
  /** よく使われるので、補わない略語(検査しない。依頼で作問役に伝える) */
  noExpand: string[];
}

/** 辞書の誤り。場所(見出しと行の番号)だけを持つ */
export class TermsError extends PathsError {
  constructor(paths: string[]) {
    super("用語の辞書の誤り", paths);
  }
}

/** 辞書の文書のパス(リポジトリ直下からの相対パス) */
export const termsPath = (vendor: string): string => `docs/exam-style/${vendor.toLowerCase()}-terms.md`;

const HEADINGS = {
  entries: "使う訳語と使わない訳語",
  pairs: "略語と正式名称",
  noExpand: "補わない略語",
} as const;

const ABBR = /^[A-Za-z][A-Za-z0-9-]*$/;
const SEPARATOR = "、";

const split = (cell: string): string[] =>
  cell
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter((s) => s !== "");

/** `## <見出し>` の下の表の、データ行(見出し行と区切り行を除く)。各行は、セルの配列と行の番号 */
function tableRows(lines: string[], heading: string): { cells: string[]; line: number }[] | null {
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rows: { cells: string[]; line: number }[] = [];
  let seenSeparator = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line.startsWith("## ")) break;
    if (!line.startsWith("|")) {
      if (seenSeparator && line === "") break;
      continue;
    }
    if (/^\|[\s:|-]+\|$/.test(line)) {
      seenSeparator = true;
      continue;
    }
    if (!seenSeparator) continue;
    rows.push({
      cells: line
        .slice(1, line.endsWith("|") ? -1 : undefined)
        .split("|")
        .map((c) => c.trim()),
      line: i + 1,
    });
  }
  return rows;
}

/** 辞書の文書の本文を読む。形が違えば、場所だけを持つ TermsError。表のない節は空として扱う */
export function parseTerms(vendor: string, text: string): Terms {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const problems: string[] = [];
  const entries: AvoidEntry[] = [];
  for (const row of tableRows(lines, HEADINGS.entries) ?? []) {
    const [use = "", avoid = "", exempt = "", note = ""] = row.cells;
    const avoidList = split(avoid);
    if (use === "" || avoidList.length === 0) problems.push(`${HEADINGS.entries}:${row.line}`);
    else if (avoidList.includes(use)) problems.push(`${HEADINGS.entries}:${row.line}:使う語と使わない語が同じ`);
    else entries.push({ use, avoid: avoidList, exempt: split(exempt), note });
  }
  const pairs: AbbreviationPair[] = [];
  for (const row of tableRows(lines, HEADINGS.pairs) ?? []) {
    const [abbr = "", full = ""] = row.cells;
    if (!ABBR.test(abbr) || full === "" || /[()（）]/.test(full)) problems.push(`${HEADINGS.pairs}:${row.line}`);
    else pairs.push({ abbr, full });
  }
  const noExpand: string[] = [];
  for (const row of tableRows(lines, HEADINGS.noExpand) ?? []) {
    const abbr = row.cells[0] ?? "";
    if (!ABBR.test(abbr)) problems.push(`${HEADINGS.noExpand}:${row.line}`);
    else noExpand.push(abbr);
  }
  const seen = new Set<string>();
  for (const abbr of [...pairs.map((p) => p.abbr), ...noExpand]) {
    if (seen.has(abbr)) problems.push(`略語の重複:${HEADINGS.pairs}・${HEADINGS.noExpand}`);
    seen.add(abbr);
  }
  if (problems.length > 0) throw new TermsError([...new Set(problems)]);
  return { vendor, entries, pairs, noExpand };
}

/** ベンダーの辞書を読む。文書がなければ null(辞書のないベンダーは、検査も受け渡しもしない) */
export function readTerms(rootDir: string, vendor: string): Terms | null {
  const file = resolve(rootDir, termsPath(vendor));
  if (!existsSync(file)) return null;
  return parseTerms(vendor, readFileSync(file, "utf8"));
}

/** 文章から、別の意味の語(対象外の語)を空白に置き換えて除く。長さを変えない */
function maskExempt(text: string, exempt: readonly string[]): string {
  let out = text;
  for (const word of [...exempt].sort((a, b) => b.length - a.length))
    out = out.split(word).join("　".repeat(word.length));
  return out;
}

/** 文章に出る、使わない語。対象外の語は除いて探す。見つけた使わない語の一覧(重複なし) */
export function findAvoidTerms(text: string, terms: Terms): string[] {
  const found = new Set<string>();
  for (const entry of terms.entries) {
    const masked = maskExempt(text, entry.exempt);
    for (const word of entry.avoid) if (masked.includes(word)) found.add(word);
  }
  return [...found];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 読む順に並べた文章の中で、略語の最初の出現に、正式名称が括弧で続いていないものの場所。
 * 括弧は半角か全角で、略語との間に空白を置かない。略語は、前後が英数字かハイフンにつながらないものだけを数える。
 */
export function findUnexpandedAbbreviations(
  ordered: readonly { path: string; text: string }[],
  terms: Terms,
): string[] {
  const paths: string[] = [];
  for (const pair of terms.pairs) {
    const token = new RegExp(`(?<![A-Za-z0-9-])${escapeRegex(pair.abbr)}(?![A-Za-z0-9-])`);
    const expanded = new RegExp(`^[(（]${escapeRegex(pair.full)}[)）]`);
    for (const { path, text } of ordered) {
      const match = token.exec(text);
      if (match === null) continue;
      if (!expanded.test(text.slice(match.index + pair.abbr.length))) paths.push(path);
      break;
    }
  }
  return paths;
}

/** 判定の基準に足す、使う語と使わない語の対(略語は、取り込みの検査が決定的に止めるので、基準には載せない) */
export function termsForCriteria(terms: Terms): string[] {
  return terms.entries.map(
    (e) => `「${e.avoid.join("」「")}」は使わず、「${e.use}」を使う${e.note === "" ? "" : `(${e.note})`}`,
  );
}
