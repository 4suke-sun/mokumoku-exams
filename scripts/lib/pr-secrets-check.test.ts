import { describe, expect, it } from "vitest";
import {
  checkAuthors,
  checkEntries,
  checkSensitiveFilenames,
  checkUnexpectedPaths,
  parseAddedLines,
  parseDenylist,
  textToEntries,
} from "./pr-secrets-check.ts";

// フィクスチャの値は、実在しない組み立て済みのダミー。
const fakeKey = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const fakeAccount = "9".repeat(12);
const fakeProfileAssignment = "AWS_" + "PROFILE=somename";
const fakeLocalPath = "/Us" + "ers/someone/work";

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
    expect(parseAddedLines(diff)).toEqual([
      { file: "a.txt", line: 5, text: "one" },
      { file: "a.txt", line: 6, text: "two" },
    ]);
  });

  it("削除されたファイルは無視する", () => {
    const diff = ["diff --git a/x b/x", "--- a/x", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone"].join("\n");
    expect(parseAddedLines(diff)).toEqual([]);
  });

  it("内容が `++ ` で始まる追加行(差分上は `+++ `)も、追加行として扱う", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -0,0 +1,2 @@",
      "+++ key = value",
      "+next",
    ].join("\n");
    expect(parseAddedLines(diff)).toEqual([
      { file: "a.txt", line: 1, text: "++ key = value" },
      { file: "a.txt", line: 2, text: "next" },
    ]);
  });

  it("複数のファイルを、それぞれのファイル名で取り出す", () => {
    const diff = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -0,0 +1 @@",
      "+a",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -0,0 +1 @@",
      "+b",
    ].join("\n");
    expect(parseAddedLines(diff).map((e) => e.file)).toEqual(["a.txt", "b.txt"]);
  });
});

describe("checkEntries", () => {
  const entry = (text: string) => [{ file: "f.md", line: 3, text }];

  it("アクセスキーを止め、値を報告に含めない", () => {
    const { blocks } = checkEntries(entry(`key = ${fakeKey}`));
    expect(blocks).toEqual(["アクセスキー ID: f.md:3"]);
    expect(blocks.join()).not.toContain(fakeKey);
  });

  it("アカウント ID の実値を止め、例示用 ID は通す", () => {
    expect(checkEntries(entry(`account: ${fakeAccount}`)).blocks).toHaveLength(1);
    expect(checkEntries(entry("account: 123456789012")).blocks).toHaveLength(0);
  });

  it("プロファイル名はプレースホルダーなら通す", () => {
    expect(checkEntries(entry("AWS_PROFILE=<プロファイル名>")).blocks).toHaveLength(0);
    expect(checkEntries(entry(fakeProfileAssignment)).blocks).toHaveLength(1);
  });

  it("拒否リストの語を、語を出さずに止める", () => {
    const { blocks } = checkEntries(entry("see Secret-Term here"), ["secret-term"]);
    expect(blocks).toEqual(["拒否リストの 1 番目の語: f.md:3"]);
  });

  it("ローカルパスは警告にとどめる", () => {
    const { blocks, warns } = checkEntries(entry(fakeLocalPath));
    expect(blocks).toHaveLength(0);
    expect(warns).toHaveLength(1);
  });

  it("作業の指示への言及は、メッセージのときだけ止める", () => {
    const text = "ユーザーの指示により変更";
    expect(checkEntries(entry(text)).blocks).toHaveLength(0);
    expect(checkEntries(textToEntries(text, "message"), [], { message: true }).blocks).toHaveLength(1);
  });

  it("問題のない文面は通す", () => {
    const { blocks, warns } = checkEntries(textToEntries("docs: 手順を追加する\n\n本文", "message"), [], {
      message: true,
    });
    expect([blocks, warns]).toEqual([[], []]);
  });
});

describe("checkSensitiveFilenames / checkUnexpectedPaths", () => {
  it(".env は止め、.env.example は通す", () => {
    expect(checkSensitiveFilenames([".env"])).toHaveLength(1);
    expect(checkSensitiveFilenames([".env.example"])).toHaveLength(0);
  });

  it("成果物ではないパスを止める", () => {
    expect(checkUnexpectedPaths([".vscode/settings.json", ".drafts/a.md", "src/index.ts"])).toHaveLength(2);
  });
});

describe("checkAuthors", () => {
  const ok = "1234+name@users.noreply.github.com";

  it("noreply 以外の作者を止める", () => {
    const hits = checkAuthors([
      { sha: "aaaaaaa", authorEmail: ok, committerEmail: ok },
      { sha: "bbbbbbb", authorEmail: "someone@example.com", committerEmail: ok },
    ]);
    expect(hits).toEqual(["noreply ではない作者アドレス: コミット bbbbbbb"]);
  });

  it("GitHub 上のマージコミットのコミッターは認めるが、作者としては認めない", () => {
    expect(checkAuthors([{ sha: "ddddddd", authorEmail: ok, committerEmail: "noreply@github.com" }])).toEqual([]);
    expect(checkAuthors([{ sha: "eeeeeee", authorEmail: "noreply@github.com", committerEmail: ok }])).toEqual([
      "noreply ではない作者アドレス: コミット eeeeeee",
    ]);
  });

  it("noreply 以外のコミッターを止める", () => {
    const hits = checkAuthors([{ sha: "ccccccc", authorEmail: ok, committerEmail: "someone@example.com" }]);
    expect(hits).toEqual(["noreply ではないコミッターアドレス: コミット ccccccc"]);
  });
});

describe("parseDenylist", () => {
  it("コメントと空行を除く", () => {
    expect(parseDenylist("# c\n\n a \nb\n")).toEqual(["a", "b"]);
  });
});
