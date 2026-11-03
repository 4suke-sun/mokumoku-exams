import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeCode, SQL_KEYWORDS } from "./normalize.ts";

describe("normalizeCode(SQL)", () => {
  it("空白・改行・インデントの違い_同じ形になる", () => {
    expect(normalizeCode("sql", "SELECT  id,\n    name\nFROM sales")).toBe(
      normalizeCode("sql", "SELECT id, name FROM sales"),
    );
  });

  it("記号の前後の空白と末尾のセミコロン_除く", () => {
    expect(normalizeCode("sql", "WHERE t.id = s.id ;")).toBe(normalizeCode("sql", "WHERE t.id=s.id"));
  });

  it("キーワードの大文字小文字_区別しない", () => {
    expect(normalizeCode("sql", "merge into customers as t")).toBe(normalizeCode("sql", "MERGE INTO customers AS t"));
  });

  it("識別子と型の名前の大文字小文字_区別する", () => {
    expect(normalizeCode("sql", "SELECT Id FROM sales")).not.toBe(normalizeCode("sql", "SELECT id FROM sales"));
    expect(normalizeCode("sql", "CAST(x AS string)")).not.toBe(normalizeCode("sql", "CAST(x AS STRING)"));
  });

  it("文字列リテラルの中_空白も大文字小文字も変えない", () => {
    expect(normalizeCode("sql", "SELECT 'a  b'")).not.toBe(normalizeCode("sql", "SELECT 'a b'"));
    expect(normalizeCode("sql", "SELECT 'select'")).not.toBe(normalizeCode("sql", "SELECT 'SELECT'"));
  });

  it("改行の形と行末の空白_そろえる", () => {
    expect(normalizeCode("sql", "SELECT id  \r\nFROM sales\r\n")).toBe(normalizeCode("sql", "SELECT id\nFROM sales"));
  });
});

describe("normalizeCode(PySpark)", () => {
  it("括弧の中の改行とインデント_空白と同じに扱う", () => {
    expect(normalizeCode("pyspark", 'df = (spark.read\n    .format("json")\n    .load(path))')).toBe(
      normalizeCode("pyspark", 'df = (spark.read.format("json").load(path))'),
    );
  });

  it("括弧の外のインデントの深さ_保つ", () => {
    const nested = "for t in tables:\n    show(t)";
    expect(normalizeCode("pyspark", nested)).not.toBe(normalizeCode("pyspark", "for t in tables:\nshow(t)"));
    expect(normalizeCode("pyspark", nested)).toBe(normalizeCode("pyspark", "for t in tables:\n  show(t)"));
  });

  it("名前の大文字小文字と引用符の種類_区別する", () => {
    expect(normalizeCode("pyspark", "df.GroupBy('a')")).not.toBe(normalizeCode("pyspark", "df.groupBy('a')"));
    expect(normalizeCode("pyspark", 'df.groupBy("a")')).not.toBe(normalizeCode("pyspark", "df.groupBy('a')"));
  });

  it("引数のまわりの空白_除く", () => {
    expect(normalizeCode("pyspark", "df.join(o, on = 'id', how = 'left')")).toBe(
      normalizeCode("pyspark", "df.join(o,on='id',how='left')"),
    );
  });
});

describe("SQL_KEYWORDS", () => {
  it("コードドリルの SQL の正解と別解に出る全大文字の語_キーワードの一覧にない語は型と形式の名前だけ", () => {
    const file = JSON.parse(
      readFileSync(new URL("../../../../data/code-drill.dbx-dea-2605.json", import.meta.url), "utf8"),
    ) as { problems: { language: string; solutions: string[] }[] };
    const words = file.problems
      .filter((p) => p.language === "sql")
      .flatMap((p) => p.solutions)
      .flatMap((s) => s.replace(/'(?:[^'\\]|\\.)*'/g, "").match(/\b[A-Z][A-Z_]+\b/g) ?? []);
    // 型・形式の名前は、大文字小文字を区別して比べる(公式の文書で、区別しないとされていないため)
    expect([...new Set(words.filter((w) => !SQL_KEYWORDS.has(w)))].sort()).toEqual(["JSON", "STRING"]);
  });
});
