/**
 * テストの題(it / test)の形の検査。題は日本語で「前提条件_期待結果」にする(CONTRIBUTING.md の「テスト」)。
 * 純粋な関数にして単体テストする(ファイルの読み書きは scripts/check-test-titles.ts)。
 * 既存の違反は基準の一覧に記録し、基準にない違反だけを止める。基準は縮むだけで、スクリプトでは増やさない(手で足した行は、レビューで見る)。
 */

export interface TestFile {
  file: string;
  text: string;
}

export interface TitleAt {
  file: string;
  line: number;
  title: string;
}

/** ファイルごとの、基準に記録した違反の題。同じ題が複数あれば、その数だけ並べる。 */
export type Baseline = Record<string, string[]>;

// it("題") / test("題") / it.each(…)("題") / it.skip・it.skipIf(…)・it.for など。題が次の行にあるものも含む。
// 修飾の引数の括弧は、1 段までの入れ子を読む。describe は対象にしない。
const MODIFIER = String.raw`(?:\.[A-Za-z]+(?:\((?:[^()]|\([^()]*\))*\))?)*`;
const TITLE = new RegExp(String.raw`^[ \t]*(?:it|test)${MODIFIER}\(\s*(["'\x60])((?:\\.|(?!\1)[^\\\n])*)\1`, "gm");

export function extractTitles(file: string, text: string): TitleAt[] {
  const found: TitleAt[] = [];
  for (const m of text.matchAll(TITLE)) {
    const line = text.slice(0, m.index).split("\n").length;
    found.push({ file, line, title: m[2] ?? "" });
  }
  return found;
}

/** 最初の `_` の前後が、どちらも空でない。 */
export function isValidTitle(rawTitle: string): boolean {
  // テンプレートリテラルの式(${…})の中の `_` は、区切りとして数えない
  const title = rawTitle.replace(/\$\{[^}]*\}/g, "式");
  const i = title.indexOf("_");
  return i > 0 && title.slice(0, i).trim() !== "" && title.slice(i + 1).trim() !== "";
}

export interface TitleCheck {
  /** 基準にない違反(場所と種類だけ) */
  violations: string[];
  /** 基準にあるが、もう違反でない(直した)題。基準から消す */
  fixed: string[];
  /** 現在の違反のうち基準にあるものだけを残した、新しい基準 */
  shrunk: Baseline;
}

export function checkTestTitles(files: TestFile[], baseline: Baseline): TitleCheck {
  const violations: string[] = [];
  const shrunk: Baseline = {};
  const fixed: string[] = [];

  for (const { file, text } of files) {
    const remaining = [...(baseline[file] ?? [])];
    for (const t of extractTitles(file, text)) {
      if (isValidTitle(t.title)) continue;
      const at = remaining.indexOf(t.title);
      if (at >= 0) {
        remaining.splice(at, 1);
        shrunk[file] = [...(shrunk[file] ?? []), t.title];
      } else {
        violations.push(`${file}:${t.line}: テストの題が「前提条件_期待結果」の形でない`);
      }
    }
    for (let i = 0; i < remaining.length; i++) fixed.push(`${file}: 基準にある題が、もう違反でない`);
  }
  // ファイル自体がなくなった基準も、直したものとして扱う
  const seen = new Set(files.map((f) => f.file));
  for (const [file, titles] of Object.entries(baseline)) {
    if (!seen.has(file)) for (let i = 0; i < titles.length; i++) fixed.push(`${file}: 基準にあるファイルが、もうない`);
  }
  return { violations, fixed, shrunk };
}
