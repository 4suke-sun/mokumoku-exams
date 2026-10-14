import { describe, expect, it } from "vitest";
import { checkTestTitles, extractTitles, isValidTitle } from "./test-title-check.ts";

describe("isValidTitle", () => {
  it("前提と期待を_でつなぐ_正しい題として扱う", () => {
    expect(isValidTitle("未ログイン_ログインの画面へ送られる")).toBe(true);
  });

  it("題に_が複数ある_最初の_で分けて正しいと判定する", () => {
    expect(isValidTitle("空_配列_何も返さない")).toBe(true);
  });

  it("区切りの_がない_誤りと判定する", () => {
    expect(isValidTitle("問題がある")).toBe(false);
  });

  it("区切りの前が空_誤りと判定する", () => {
    expect(isValidTitle("_期待だけ")).toBe(false);
    expect(isValidTitle("  _期待だけ")).toBe(false);
  });

  it("式の中だけに区切りがある_誤りと判定する", () => {
    expect(isValidTitle(`上限は\${MAX_RESULTS}件`)).toBe(false);
    expect(isValidTitle(`上限は\${MAX_RESULTS}件_切り捨てる`)).toBe(true);
  });

  it("区切りの後が空_誤りと判定する", () => {
    expect(isValidTitle("前提だけ_")).toBe(false);
  });
});

describe("extractTitles", () => {
  it("itとtestとeachとskip_題と行番号を取り出す", () => {
    const text = [
      'it("一_二", () => {});',
      "  test('三_四', () => {});",
      "it.each([1, 2])(`五_六`, () => {});",
      'it.skip("七_八", () => {});',
    ].join("\n");
    expect(extractTitles("a.test.ts", text)).toEqual([
      { file: "a.test.ts", line: 1, title: "一_二" },
      { file: "a.test.ts", line: 2, title: "三_四" },
      { file: "a.test.ts", line: 3, title: "五_六" },
      { file: "a.test.ts", line: 4, title: "七_八" },
    ]);
  });

  it("修飾の引数に括弧がある_取り出す", () => {
    const text = 'it.each(list.slice(0, 2))("一_二", () => {});\nit.skipIf(isCi())("三_四", () => {});';
    expect(extractTitles("a.test.ts", text).map((t) => t.title)).toEqual(["一_二", "三_四"]);
  });

  it("onlyとconcurrentとforとtodo_取り出す", () => {
    const text = [
      'it.only("一_二", f);',
      'it.concurrent("三_四", f);',
      'it.for([1])("五_六", f);',
      'it.todo("七_八");',
    ];
    expect(extractTitles("a.test.ts", text.join("\n")).map((t) => t.title)).toEqual([
      "一_二",
      "三_四",
      "五_六",
      "七_八",
    ]);
  });

  it("題が次の行にある_取り出す", () => {
    expect(extractTitles("a.test.ts", 'it(\n  "一_二",\n  () => {},\n);')).toEqual([
      { file: "a.test.ts", line: 1, title: "一_二" },
    ]);
  });

  it("describeと呼び出しでない文字列_対象にしない", () => {
    expect(extractTitles("a.test.ts", 'describe("題なし", () => {});\nconst it = "x";\nawait("y");')).toEqual([]);
  });
});

describe("checkTestTitles", () => {
  const files = [{ file: "a.test.ts", text: 'it("違反", () => {});\nit("正しい_題", () => {});' }];

  it("基準にない違反がある_場所と種類だけを返す", () => {
    const result = checkTestTitles(files, {});
    expect(result.violations).toEqual(["a.test.ts:1: テストの題が「前提条件_期待結果」の形でない"]);
    expect(result.violations.join("")).not.toContain("違反");
  });

  it("違反が基準にある_止めない", () => {
    const result = checkTestTitles(files, { "a.test.ts": ["違反"] });
    expect(result.violations).toEqual([]);
    expect(result.shrunk).toEqual({ "a.test.ts": ["違反"] });
  });

  it("同じ題の違反が基準より多い_超えた分を止める", () => {
    const text = 'it("違反", () => {});\nit("違反", () => {});';
    const result = checkTestTitles([{ file: "a.test.ts", text }], { "a.test.ts": ["違反"] });
    expect(result.violations).toHaveLength(1);
  });

  it("基準の題が直された_直したものとして返し基準から消す", () => {
    const fixedFiles = [{ file: "a.test.ts", text: 'it("直した_題", () => {});' }];
    const result = checkTestTitles(fixedFiles, { "a.test.ts": ["違反"] });
    expect(result.fixed).toHaveLength(1);
    expect(result.shrunk).toEqual({});
  });

  it("基準のファイルがない_直したものとして返す", () => {
    const result = checkTestTitles([], { "gone.test.ts": ["違反"] });
    expect(result.fixed).toEqual(["gone.test.ts: 基準にあるファイルが、もうない"]);
  });
});
