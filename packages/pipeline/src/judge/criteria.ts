import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "../collect/fetcher.ts";
import { styleGuidePaths } from "../scorecard/profiles.ts";

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
