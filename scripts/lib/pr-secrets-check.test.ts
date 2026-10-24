import { describe, expect, it } from "vitest";
import {
  CLAUDE_NOREPLY,
  checkAuthors,
  checkEntries,
  checkProseBodies,
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

  it("ユーザープール ID の実値を止め、プレースホルダーは通す", () => {
    const pool = ["ap-northeast-1", "AbCd1234E"].join("_");
    expect(checkEntries(entry(`pool: ${pool}`)).blocks).toEqual(["Cognito のユーザープール ID: f.md:3"]);
    expect(checkEntries(entry(`pool: ap-northeast-1_${"x".repeat(9)}`)).blocks).toHaveLength(0);
    expect(checkEntries(entry("pool: us-east-1_EXAMPLE12")).blocks).toHaveLength(0);
  });

  it("クライアント ID は名前つきの代入で止め、プレースホルダーと名前のない文字列は通す", () => {
    const id = `${"a1b2c3d4e5".repeat(2)}f6g7h8`;
    expect(checkEntries(entry(`COGNITO_CLIENT_ID=${id}`)).blocks).toEqual(["Cognito のクライアント ID: f.md:3"]);
    expect(checkEntries(entry(`clientId: "${id}"`)).blocks).toHaveLength(1);
    // キーを引用符で囲んだ形(JSON など)
    expect(checkEntries(entry(`"COGNITO_CLIENT_ID": "${id}"`)).blocks).toHaveLength(1);
    expect(checkEntries(entry(`'clientId': ${id}`)).blocks).toHaveLength(1);
    expect(checkEntries(entry("COGNITO_CLIENT_ID=<クライアント ID>")).blocks).toHaveLength(0);
    expect(checkEntries(entry("COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx")).blocks).toHaveLength(0);
    expect(checkEntries(entry(`token ${id}`)).blocks).toHaveLength(0);
  });

  it("配信のドメインの実値を止め、プレースホルダーと例示は通す", () => {
    const domain = `d${"a".repeat(13)}.cloudfront.net`;
    expect(checkEntries(entry(`https://${domain}/`)).blocks).toEqual(["配信のドメイン: f.md:3"]);
    expect(checkEntries(entry("https://xxxx.cloudfront.net/")).blocks).toHaveLength(0);
    expect(checkEntries(entry("https://d111111abcdef8.cloudfront.net/")).blocks).toHaveLength(0);
    expect(checkEntries(entry("https://example.cloudfront.net/")).blocks).toHaveLength(0);
  });

  it("Function URL の実値を止め、プレースホルダーは通す", () => {
    const url = `https://${"a1b2c3d4e5".repeat(2)}.lambda-url.ap-northeast-1.on.aws/`;
    expect(checkEntries(entry(url)).blocks).toEqual(["Lambda の Function URL: f.md:3"]);
    expect(checkEntries(entry(`https://${"x".repeat(20)}.lambda-url.us-east-1.on.aws/`)).blocks).toHaveLength(0);
    expect(checkEntries(entry("https://example.lambda-url.us-east-1.on.aws/")).blocks).toHaveLength(0);
  });

  it("検出の報告に値が出ない", () => {
    const id = `${"a1b2c3d4e5".repeat(2)}f6g7h8`;
    expect(checkEntries(entry(`COGNITO_CLIENT_ID=${id}`)).blocks.join()).not.toContain(id);
  });

  it("許可する宛先以外のメールアドレスを止め、場所と種類だけを報告する", () => {
    const personal = ["someone", "gmail.com"].join("@");
    const corporate = ["a.b+c", "mail.example.co.jp"].join("@");
    expect(checkEntries(entry(`連絡先: ${personal}`)).blocks).toEqual(["許可されていないメールアドレス: f.md:3"]);
    expect(checkEntries(entry(corporate)).blocks).toHaveLength(1);
    expect(checkEntries(entry(personal)).blocks.join()).not.toContain("someone");
  });

  it("noreply・予約済みのドメイン・署名の行・URL の認証情報の形は通す", () => {
    const ok = [
      "1234+name@users.noreply.github.com",
      "noreply@github.com",
      "user@example.com",
      "user@mail.example.org",
      "user@host.test",
      "git@github.com:owner/repo.git",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
      "https://user:pass@host.example.net/path",
      "postgres://admin@db.example.net:5432/app",
      "npm i pkg@1.2.3 @scope/pkg@2.0.0-beta.1",
    ];
    for (const text of ok) expect(checkEntries(entry(text)).blocks, text).toHaveLength(0);
  });

  it("プロファイル名はプレースホルダーなら通す", () => {
    expect(checkEntries(entry("AWS_PROFILE=<プロファイル名>")).blocks).toHaveLength(0);
    expect(checkEntries(entry(fakeProfileAssignment)).blocks).toHaveLength(1);
  });

  it("拒否リストの語を、語を出さずに止める", () => {
    const { blocks } = checkEntries(entry("see Secret-Term here"), ["secret-term"]);
    expect(blocks).toEqual(["拒否リストの 1 番目の語: f.md:3"]);
  });

  it("ローカルパスは止め、プレースホルダーは通す", () => {
    const { blocks, warns } = checkEntries(entry(fakeLocalPath));
    expect(blocks).toEqual(["ローカルのユーザーディレクトリのパス: f.md:3"]);
    expect(warns).toHaveLength(0);
    expect(blocks.join()).not.toContain("someone");
    for (const text of [
      "/Us" + "ers/<ユーザー名>/work",
      "/Us" + "ers/example/work",
      "/Us" + "ers/ など",
      "/api/admin/users/abc",
    ]) {
      expect(checkEntries(entry(text)).blocks, text).toHaveLength(0);
    }
  });

  it("Claude のセッションへのリンクは、メッセージのときだけ止める", () => {
    const link = "Claude-Session: https://claude.ai/code/session_example";
    const msg = checkEntries(textToEntries(link, "message"), [], { message: true });
    expect(msg.blocks).toEqual(["Claude のセッションへのリンク: message:1"]);
    expect(msg.blocks.join()).not.toContain("session_example");
    expect(checkEntries(entry(link)).blocks).toHaveLength(0);
    // push の範囲の履歴には掛けない(すでに履歴にあるものは、書き換えない)
    expect(checkEntries(textToEntries(link, "message"), [], { message: true, history: true }).blocks).toHaveLength(0);
    // 署名の行(Co-Authored-By)とは区別する
    const signature = textToEntries("Co-Authored-By: Claude <noreply@anthropic.com>", "message");
    expect(checkEntries(signature, [], { message: true }).blocks).toHaveLength(0);
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

  it("作者・コミッターが Claude の署名用の noreply_通す", () => {
    const upper = CLAUDE_NOREPLY.toUpperCase();
    expect(checkAuthors([{ sha: "fffffff", authorEmail: CLAUDE_NOREPLY, committerEmail: CLAUDE_NOREPLY }])).toEqual([]);
    expect(checkAuthors([{ sha: "fffffff", authorEmail: upper, committerEmail: ok }])).toEqual([]);
  });

  it("Claude の署名用の noreply に似た形_作者・コミッターのどちらでも止める", () => {
    const [local, domain] = CLAUDE_NOREPLY.split("@");
    for (const email of [
      `x${CLAUDE_NOREPLY}`,
      `${CLAUDE_NOREPLY}x`,
      `${CLAUDE_NOREPLY}.example.com`,
      `${local}@sub.${domain}`,
      `support@${domain}`,
      ` ${CLAUDE_NOREPLY}`,
    ]) {
      expect(checkAuthors([{ sha: "1111111", authorEmail: email, committerEmail: ok }])).toEqual([
        "noreply ではない作者アドレス: コミット 1111111",
      ]);
      expect(checkAuthors([{ sha: "2222222", authorEmail: ok, committerEmail: email }])).toEqual([
        "noreply ではないコミッターアドレス: コミット 2222222",
      ]);
    }
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

describe("checkProseBodies", () => {
  const entry = (file: string, line: number, text: string) => ({ file, line, text });
  const ledger = "packages/pipeline/ledger/example.json";
  const longJa = "これは出典の本文を写した長い文章です。".repeat(20);
  const longEn = "This sentence is a long copied passage from a source document. ".repeat(4);

  it("台帳の形(ハッシュ・URL・短い言い換え)_止めない", () => {
    const entries = [
      entry(ledger, 1, `    "sourceHash": "${"a".repeat(64)}",`),
      entry(ledger, 2, '    "url": "https://example.com/guide/some/long/path/that/keeps/going/and/going/index.html",'),
      entry(ledger, 3, '    "paraphrase": "サービスの上限は既定で 100 件である。",'),
    ];
    expect(checkProseBodies(entries)).toEqual([]);
  });

  it("長い日本語の本文_止める。報告に本文を含めない", () => {
    const hits = checkProseBodies([entry(ledger, 5, `    "text": "${longJa}",`)]);
    expect(hits).toEqual([`本文らしい長い文章: ${ledger}:5`]);
    expect(hits.join("")).not.toContain("出典の本文");
  });

  it("長い英語の本文_止める", () => {
    expect(checkProseBodies([entry(ledger, 2, longEn)])).toEqual([`本文らしい長い文章: ${ledger}:2`]);
  });

  it("折り返された本文_連続した長めの行を止める", () => {
    const wrapped = Array.from({ length: 4 }, (_, i) => entry("packages/pipeline/work/a.txt", 10 + i, "あ".repeat(70)));
    expect(checkProseBodies(wrapped)).toEqual(["本文らしい折り返された文章: packages/pipeline/work/a.txt:10"]);
  });

  it("短い行をはさむ_折り返しとみなさない", () => {
    const lines = [70, 70, 10, 70, 70].map((n, i) => entry(ledger, 1 + i, "あ".repeat(n)));
    expect(checkProseBodies(lines)).toEqual([]);
  });

  it("対象外のファイル(ソース・文書・data)_長い文章があっても止めない", () => {
    expect(checkProseBodies([entry("packages/pipeline/src/a.ts", 1, longJa)])).toEqual([]);
    expect(checkProseBodies([entry("docs/a.md", 1, longJa)])).toEqual([]);
    expect(checkProseBodies([entry("data/questions.x.json", 1, `"explanation": "${longJa}"`)])).toEqual([]);
  });

  it("拡張子の大文字と、その他のデータ形式_対象にする", () => {
    expect(checkProseBodies([entry("packages/pipeline/x/A.JSON", 1, longJa)])).toHaveLength(1);
    expect(checkProseBodies([entry("packages/pipeline/x/a.jsonl", 1, longJa)])).toHaveLength(1);
    expect(checkProseBodies([entry("packages/pipeline/x/a.yaml", 1, longJa)])).toHaveLength(1);
  });

  it("URL で始まる日本語の本文_URL とはみなさず止める", () => {
    expect(checkProseBodies([entry(ledger, 1, `"text": "https://example.com/${longJa}"`)])).toHaveLength(1);
  });

  it("空白が極端に長い行_短い時間で終わる", () => {
    const start = Date.now();
    checkProseBodies([entry(ledger, 1, `"a": "${" ".repeat(200_000)}x`)]);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("checkEntries に含まれる_差分の検査が止める", () => {
    expect(checkEntries([entry(ledger, 1, longJa)]).blocks).toEqual([`本文らしい長い文章: ${ledger}:1`]);
  });

  it("作業用の置き場のパス_混入として止める", () => {
    expect(checkUnexpectedPaths(["pipeline-work/guide.html"])).toHaveLength(1);
  });
});
