/**
 * コードドリルの全文入力の正規化。データの検査(別解の重なり)と、画面の判定で、同じ関数を使う。
 * 決まりは docs/data-spec.md の「15. コードドリルのデータ」の「全文入力の判定」。
 * - 両方の言語: 改行の形をそろえ、行末の空白と空行を除く。文字列リテラル(`'…'`・`"…"`)の中は変えない。
 * - SQL: 文字列リテラルの外の空白の連続(改行とインデントを含む)を 1 つにし、記号の前後の空白を除き、末尾の `;` を除く。
 *   キーワード(`SQL_KEYWORDS`)は、大文字小文字を区別しない(公式の文書で、キーワードは大文字小文字を区別しないとされている)。
 *   識別子と文字列リテラルは、大文字小文字を区別する。
 * - PySpark: 括弧の中の改行とインデントは、空白 1 つと同じに扱う。括弧の外の行頭のインデントは、深さの相対を保つ。
 *   名前と文字列リテラルは、大文字小文字を区別する。引用符の種類はそろえない。
 */

export type CodeLanguage = "sql" | "pyspark";

/** 大文字小文字を区別しない SQL のキーワード。コードドリルの正解・別解に出る全大文字の語は、すべてここにある(テストで確かめる) */
export const SQL_KEYWORDS: ReadonlySet<string> = new Set(
  `ADD ALL ALTER AND ANTI ANY AS ASC AUTO BETWEEN BY CASE CAST CATALOG CHANGE COLUMN COLUMNS COMMENT CONSTRAINT COPY CREATE CROSS
  CURRENT DATABASE DEFAULT DELETE DESC DESCRIBE DISTINCT DROP ELSE END EXCEPT EXISTS EXPECT EXPLAIN EXTERNAL FALSE FETCH FILES
  FILTER FOR FORMAT FORMAT_OPTIONS COPY_OPTIONS FROM FULL FUNCTION GRANT GROUP HAVING IF IN INNER INSERT INTERSECT INTO IS JOIN
  LATERAL LEFT LIKE LIMIT LIVE LOCATION MASK MATCHED MATERIALIZED MERGE MODIFY NOT NULL NULLS ON OPTIONS OR ORDER OUTER OVER
  OVERWRITE PARTITION PATTERN PRIVILEGES REFRESH REPLACE RETURN RETURNS REVOKE RIGHT ROW ROWS SCHEMA SELECT SEMI SET SHOW SOURCE
  STREAM STREAMING TABLE TABLES TARGET THEN TO TRUE TRUNCATE UNION UPDATE USE USING VALUES VIEW VIOLATION WHEN WHERE WINDOW WITH
  FILEFORMAT JSON CSV PARQUET AVRO ORC TEXT BINARYFILE DELTA STRING INT INTEGER BIGINT SMALLINT TINYINT DOUBLE FLOAT DECIMAL
  BOOLEAN DATE TIMESTAMP ARRAY MAP STRUCT`
    .split(/\s+/)
    .filter(Boolean),
);

/** 文字列リテラル(単引用符・二重引用符。バックスラッシュのエスケープを含む)と、それ以外に分ける */
function splitLiterals(code: string): { text: string; literal: boolean }[] {
  const parts: { text: string; literal: boolean }[] = [];
  const pattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
  let last = 0;
  for (const match of code.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: code.slice(last, match.index), literal: false });
    parts.push({ text: match[0], literal: true });
    last = match.index + match[0].length;
  }
  if (last < code.length) parts.push({ text: code.slice(last), literal: false });
  return parts;
}

/** 記号の前後の空白を除く(リテラルの外だけで使う) */
const PUNCTUATION_SPACES = /\s*([()[\]{},;=<>+\-*/:.])\s*/g;

function normalizeSql(code: string): string {
  const out = splitLiterals(code)
    .map((part) =>
      part.literal
        ? part.text
        : part.text
            .replace(/\s+/g, " ")
            .replace(PUNCTUATION_SPACES, "$1")
            .replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) =>
              SQL_KEYWORDS.has(word.toUpperCase()) ? word.toUpperCase() : word,
            ),
    )
    .join("")
    .trim();
  return out.replace(/;$/, "").trim();
}

function normalizePyspark(code: string): string {
  // 行の継続(`\` と改行)は、空白 1 つと同じに扱う
  const joined = code.replace(/\\\n/g, " ");
  const parts = splitLiterals(joined);
  // 括弧の中の改行を空白にする(リテラルの外の括弧の深さを数える)
  let depth = 0;
  const flat = parts
    .map((part) => {
      if (part.literal) return part.text;
      let text = "";
      for (const ch of part.text) {
        if ("([{".includes(ch)) depth++;
        if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
        text += depth > 0 && ch === "\n" ? " " : ch;
      }
      return text;
    })
    .join("");
  // 行ごとに、行頭のインデントを深さの段数に置き換え、行の中の空白をそろえる
  const lines = flat.split("\n").filter((line) => line.trim() !== "");
  const widths = [
    ...new Set(lines.map((line) => (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length)),
  ].sort((a, b) => a - b);
  return lines
    .map((line) => {
      const width = (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
      const body = splitLiterals(line.trim())
        .map((part) => (part.literal ? part.text : part.text.replace(/\s+/g, " ").replace(PUNCTUATION_SPACES, "$1")))
        .join("");
      return `${"\t".repeat(widths.indexOf(width))}${body}`;
    })
    .join("\n");
}

/** 全文入力の比較に使う形にする */
export function normalizeCode(language: CodeLanguage, code: string): string {
  const unified = code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .trim();
  return language === "sql" ? normalizeSql(unified) : normalizePyspark(unified);
}
