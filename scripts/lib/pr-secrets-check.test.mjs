import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkAuthors,
  checkEntries,
  checkSensitiveFilenames,
  checkUnexpectedPaths,
  parseAddedLines,
  parseDenylist,
  textToEntries,
} from "./pr-secrets-check.mjs";

// フィクスチャの値は、実在しない組み立て済みのダミー。
const fakeKey = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const fakeAccount = "9".repeat(12);

describe("parseAddedLines", () => {
  it("追加行をファイルと行番号つきで取り出す", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1,0 +5,2 @@",
      "+one",
      "+two",
      "-removed",
    ].join("\n");
    assert.deepEqual(parseAddedLines(diff), [
      { file: "a.txt", line: 5, text: "one" },
      { file: "a.txt", line: 6, text: "two" },
    ]);
  });

  it("削除されたファイルは無視する", () => {
    const diff = ["--- a/x", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"].join("\n");
    assert.deepEqual(parseAddedLines(diff), []);
  });
});

describe("checkEntries", () => {
  const entry = (text) => [{ file: "f.md", line: 3, text }];

  it("アクセスキーを止め、値を報告に含めない", () => {
    const { blocks } = checkEntries(entry(`key = ${fakeKey}`));
    assert.deepEqual(blocks, ["アクセスキー ID: f.md:3"]);
    assert.ok(!blocks.join().includes(fakeKey));
  });

  it("アカウント ID の実値を止め、例示用 ID は通す", () => {
    assert.equal(checkEntries(entry(`account: ${fakeAccount}`)).blocks.length, 1);
    assert.equal(checkEntries(entry("account: 123456789012")).blocks.length, 0);
  });

  it("プロファイル名はプレースホルダーなら通す", () => {
    assert.equal(checkEntries(entry("AWS_PROFILE=<プロファイル名>")).blocks.length, 0);
    assert.equal(checkEntries(entry("AWS_" + "PROFILE=somename")).blocks.length, 1);
  });

  it("拒否リストの語を、語を出さずに止める", () => {
    const { blocks } = checkEntries(entry("see Secret-Term here"), ["secret-term"]);
    assert.deepEqual(blocks, ["拒否リストの 1 番目の語: f.md:3"]);
  });

  it("ローカルパスは警告にとどめる", () => {
    const { blocks, warns } = checkEntries(entry("/Us" + "ers/someone/work"));
    assert.equal(blocks.length, 0);
    assert.equal(warns.length, 1);
  });

  it("作業の指示への言及は、メッセージのときだけ止める", () => {
    const text = "ユーザーの指示により変更";
    assert.equal(checkEntries(entry(text)).blocks.length, 0);
    assert.equal(checkEntries(textToEntries(text, "message"), [], { message: true }).blocks.length, 1);
  });

  it("問題のない文面は通す", () => {
    const { blocks, warns } = checkEntries(textToEntries("docs: 手順を追加する\n\n本文", "message"), [], { message: true });
    assert.deepEqual([blocks, warns], [[], []]);
  });
});

describe("checkSensitiveFilenames / checkUnexpectedPaths", () => {
  it(".env は止め、.env.example は通す", () => {
    assert.equal(checkSensitiveFilenames([".env"]).length, 1);
    assert.equal(checkSensitiveFilenames([".env.example"]).length, 0);
  });

  it("成果物ではないパスを止める", () => {
    const hits = checkUnexpectedPaths([".vscode/settings.json", ".drafts/a.md", "src/index.ts"]);
    assert.equal(hits.length, 2);
  });
});

describe("checkAuthors", () => {
  it("noreply 以外の作者を止める", () => {
    const hits = checkAuthors([
      { sha: "aaaaaaa", email: "1234+name@users.noreply.github.com" },
      { sha: "bbbbbbb", email: "someone@example.com" },
    ]);
    assert.deepEqual(hits, ["noreply ではない作者アドレス: コミット bbbbbbb"]);
  });
});

describe("parseDenylist", () => {
  it("コメントと空行を除く", () => {
    assert.deepEqual(parseDenylist("# c\n\n a \nb\n"), ["a", "b"]);
  });
});
