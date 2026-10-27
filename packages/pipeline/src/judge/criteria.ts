import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "../collect/fetcher.ts";
import { LedgerError, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { type Output, report } from "../log.ts";
import { styleGuidePaths } from "../scorecard/profiles.ts";
import { hasScopeLists, type ScopeLists, scopeListsOf } from "../shared/scope.ts";

/**
 * 判定の基準: 資格別の書き方の文書(docs/exam-style/<ベンダー>-<略称>.md)の「判定の基準」の節。
 * 依頼にこの節の本文を載せ、判定役は、その節だけを基準にする。基準が変わると、ハッシュが変わり、判定をやり直す。
 */
export interface Criteria {
  /** 文書のパス(リポジトリ直下からの相対パス) */
  path: string;
  /** 節の本文(見出しの行を含む) */
  text: string;
  hash: string;
}

/** 範囲の一覧の見出し。判定の基準の末尾に足す。節の外(`## ` の見出しの下)ではなく、基準の一部として渡す */
const SCOPE_HEADING = "### 試験ガイドの範囲の一覧(台帳から。J5 の範囲の判断に使う)";

/**
 * 判定の基準に、試験ガイドの対象サービス・対象外サービスの一覧を足す(ADR 0024)。判定役は、基準の本文だけを読むので、
 * 一覧を基準の末尾に載せる。ハッシュも一覧を含み、一覧が変わると判定をやり直す。一覧がなければ、そのまま返す。
 */
export function withScope(criteria: Criteria, lists: ScopeLists): Criteria {
  if (!hasScopeLists(lists)) return criteria;
  const lines = [SCOPE_HEADING, ""];
  if (lists.inScope.length > 0) lines.push(`対象のサービス: ${lists.inScope.join("、")}`);
  if (lists.outOfScope.length > 0) lines.push(`対象外のサービス: ${lists.outOfScope.join("、")}`);
  const text = `${criteria.text}\n\n${lines.join("\n")}`;
  return { ...criteria, text, hash: sha256(Buffer.from(text)) };
}

/**
 * 判定・書き直しの復帰・非公開への移動が使う判定の基準を読む(基準の文書に、台帳の範囲の一覧を足したもの)。
 * 基準の文書の節がなければ null。台帳が読めなければ、誤りを報告して undefined
 */
export function readCriteriaWithScope(
  config: Config,
  rootDir: string,
  examCode: string,
  output: Output,
): Criteria | null | undefined {
  const criteria = readCriteria(rootDir, examCode);
  if (criteria === null) return null;
  try {
    const ledger = readLedger(ledgerPath(resolve(rootDir, config.ledgerDir), examCode), examCode);
    return withScope(criteria, scopeListsOf(ledger.guide));
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    for (const p of error.paths) report(output, "台帳の誤り", p);
    return undefined;
  }
}

/** 節の見出し(`## 6. 判定の基準` のように、番号は問わない) */
const HEADING = /^## (?:\d+\. )?判定の基準$/m;

/** 文書から、判定の基準の節を取り出す。節の終わりは、次の `## ` の見出しか、文書の終わり。なければ null */
export function extractCriteria(doc: string): string | null {
  const text = doc.replace(/\r\n/g, "\n");
  const start = HEADING.exec(text);
  if (start === null) return null;
  const rest = text.slice(start.index);
  const next = /\n## /.exec(rest.slice(start[0].length));
  const section = next === null ? rest : rest.slice(0, start[0].length + next.index);
  return section.trim();
}

/** 資格の判定の基準を読む。帯のない資格、文書がない、節がないときは null */
export function readCriteria(rootDir: string, examCode: string): Criteria | null {
  const path = styleGuidePaths(examCode)?.[1];
  if (path === undefined) return null;
  const file = resolve(rootDir, path);
  if (!existsSync(file)) return null;
  const text = extractCriteria(readFileSync(file, "utf8"));
  if (text === null) return null;
  return { path, text, hash: sha256(Buffer.from(text)) };
}
