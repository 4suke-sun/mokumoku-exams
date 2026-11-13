import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { envValues, MASK, maskLine, maskValues } from "./output-mask.ts";
import { checkEntries, textToEntries } from "./pr-secrets-check.ts";

// フィクスチャの値は、規則的な並びのダミー。検査の正規表現に掛かる形にするため、文字列を分けて書く。
const ACCOUNT = "1111" + "2222" + "3333";
const REGION = "ap-northeast-1";
const ZONE = "Z0" + "AAAAAAAAAAAA1";
const POOL = `${REGION}_AAAAAAAA1`;
const DIST = "d0000000" + "0000000.cloudfront.net";
const FN_URL = `${"a".repeat(20)}.lambda-url.${REGION}.on.aws`;
const CLIENT = `${"a1".repeat(10)}b2b2`;
const KEY = "AK" + "IA" + "ABCDEFGHIJKLMNOP";
const SECRET = "dummy-" + "origin-verify-value";
const EMAIL = "someone" + "@" + "mail.no-such-domain.zz";
const script = fileURLToPath(new URL("../mask-output.ts", import.meta.url));

/** 検査(コミット・push・PR と同じ正規表現)に掛かる行の数 */
function hits(text: string): number {
  return checkEntries(textToEntries(text, "output")).blocks.length;
}

describe("maskLine", () => {
  it("差分・デプロイの出力に出るリソース ID の形_どれも伏せ、検査に掛からない", () => {
    const lines = [
      `  arn:aws:lambda:${REGION}:${ACCOUNT}:function:app`,
      `    HostedZoneId: ${ZONE}`,
      `    UserPoolId: ${POOL}`,
      `    DomainName: ${DIST}`,
      `    FunctionUrl: https://${FN_URL}/`,
      `    "COGNITO_CLIENT_ID": "${CLIENT}"`,
      `    AccessKeyId: ${KEY}`,
      `    Account ${ACCOUNT}`,
      `    AlarmEmail: ${EMAIL}`,
    ];
    for (const line of lines) {
      const result = maskLine(line, []);
      expect(result.masked, line).toBe(true);
      expect(result.leaked, line).toBe(false);
      expect(result.text).toContain(MASK);
      expect(hits(result.text), line).toBe(0);
    }
  });

  it("正規表現の文脈になる値(リージョン)も伏せる値にある_正規表現を先に掛け、ID を取りこぼさない", () => {
    for (const line of [`arn:aws:iam::${ACCOUNT}:role/app ${REGION}`, `pool ${POOL}`, `https://${FN_URL}/`]) {
      const result = maskLine(line, [REGION]);
      expect(result.text, line).not.toContain(ACCOUNT);
      expect(result.text).not.toContain(REGION);
      expect(result.text).not.toContain("a".repeat(20));
      expect(result.leaked).toBe(false);
    }
  });

  it(".env の値と拒否リストの語_正規表現に掛からない形でも、大文字小文字を問わず伏せる", () => {
    const result = maskLine(`ORIGIN_VERIFY_VALUE: ${SECRET.toUpperCase()} by Somename`, [SECRET, "somename"]);
    expect(result.text).toBe(`ORIGIN_VERIFY_VALUE: ${MASK} by ${MASK}`);
    expect(result.leaked).toBe(false);
  });

  it("端末の色の並びが値の途中に入る_除いてから伏せる", () => {
    const result = maskLine(`arn:aws:iam::\u001b[1m${ACCOUNT}\u001b[22m:role/app`, []);
    expect(result.text).not.toContain(ACCOUNT);
    expect(result.leaked).toBe(false);
  });

  it("伏せた印に含まれる値_置き換えても行に残るので、出さない", () => {
    expect(maskLine("value 伏せた値", ["伏せた値"]).leaked).toBe(true);
  });

  it("値のない行_そのまま返す", () => {
    expect(maskLine("[~] AWS::Lambda::Function App", [])).toEqual({
      text: "[~] AWS::Lambda::Function App",
      masked: false,
      leaked: false,
    });
  });
});

describe("maskLine のホームの下のパス", () => {
  // ダミーのパスは、連結で組み立てる(docs/app/lessons/0001-test-dummy-values-concat.md)
  const HOME = "/Us" + "ers/someone";

  it("後半が英数字だけのパス_全体を伏せる", () => {
    expect(maskLine(`cwd: ${HOME}/work/repo-x/src`, []).text).toBe(`cwd: ${MASK}`);
  });

  it("後半に日本語を含むパス_全体を伏せる", () => {
    expect(maskLine(`${HOME}/書類/練習/app`, []).text).toBe(MASK);
  });

  it("引用符・括弧・カンマで囲まれた、または区切られたパス_パスだけを伏せ、前後の文字を残す", () => {
    expect(maskLine(`"${HOME}/a/b", (${HOME}/c) x`, []).text).toBe(`"${MASK}", (${MASK}) x`);
    expect(maskLine(`'${HOME}/a';next`, []).text).toBe(`'${MASK}';next`);
  });

  it("1 行に 2 つ以上のパス_すべてを伏せる", () => {
    expect(maskLine(`cp ${HOME}/a/x ${HOME}/b/y`, []).text).toBe(`cp ${MASK} ${MASK}`);
  });

  it("ホームの直下だけのパス_伏せる", () => {
    expect(maskLine(`home=${HOME}`, []).text).toBe(`home=${MASK}`);
  });

  it("空白を含むパス_空白の前までを伏せ、残りは検査に掛からなければ出す", () => {
    const r = maskLine(`${HOME}/my dir/file`, []);
    expect(r.text).toBe(`${MASK} dir/file`);
    expect(r.leaked).toBe(false);
  });

  it("プレースホルダーのパス_伏せない", () => {
    for (const line of ["/Us" + "ers/<ユーザー名>/work", "/Us" + "ers/example/work"]) {
      expect(maskLine(line, [])).toEqual({ text: line, masked: false, leaked: false });
    }
  });
});

describe("envValues と maskValues", () => {
  it("空・短い値・プレースホルダー_伏せる値に含めず、まとめた値は重複を除いて長い順に並べる", () => {
    const env = envValues({ A: "", B: "abc", C: "<プロファイル名>", D: "abcd", E: "abcdefgh", F: " abcd " });
    expect(env).toEqual(["abcd", "abcdefgh", "abcd"]);
    expect(maskValues(env, ["xy"])).toEqual(["abcdefgh", "abcd", "xy"]);
  });
});

describe("mask-output コマンド", { timeout: 60_000 }, () => {
  it("差分の出力を流す_1 行ずつ伏せて出し、件数を標準エラーに書き、検査に掛かる行が残らない", () => {
    const input = ["Stack web", `    arn:aws:iam::${ACCOUNT}:role/app`, `    \u001b[32m${DIST}\u001b[39m`, "done"].join(
      "\n",
    );
    expect(hits(input)).toBeGreaterThan(0);
    const r = spawnSync(process.execPath, [script], { input, encoding: "utf8", env: { ...process.env, CI: "1" } });
    expect(r.status, r.stderr).toBe(0);
    // 手元の .env と拒否リストの値でも伏せうるので、行の数と、検査に掛からないことを確かめる
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(4);
    expect(hits(r.stdout)).toBe(0);
    expect(r.stdout).not.toContain(ACCOUNT);
    expect(r.stderr).toMatch(/値を伏せた行 \d+ 件、伏せきれずに出さなかった行 0 件/);
  });

  it("手元で拒否リストが見つからない_何も出さずに入力を読み捨て、終了コード 1 で止まる", () => {
    const input = Array.from({ length: 5000 }, (_, i) => `line ${i} arn:aws:iam::${ACCOUNT}:role/app`).join("\n");
    const { CI: _ci, ...env } = process.env;
    const r = spawnSync(process.execPath, [script], {
      input,
      encoding: "utf8",
      cwd: mkdtempSync(join(tmpdir(), "mask-nolist-")),
      env: { ...env, GIT_CEILING_DIRECTORIES: tmpdir() },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("拒否リストの語を含み伏せきれない行がある_その行だけを出さず、件数を数える", () => {
    const dir = mkdtempSync(join(tmpdir(), "mask-list-"));
    spawnSync("git", ["init", "-q"], { cwd: dir });
    // 伏せた印に含まれる語は、置き換えても行に残るので、伏せきれない
    writeFileSync(join(dir, ".pr-secrets-denylist"), "伏せた値\n");
    const { CI: _ci, ...env } = process.env;
    const r = spawnSync(process.execPath, [script], {
      input: "ok\nvalue 伏せた値\nend",
      encoding: "utf8",
      cwd: dir,
      env,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("ok\nend\n");
    expect(r.stderr).toContain("伏せきれずに出さなかった行 1 件");
  });
});
