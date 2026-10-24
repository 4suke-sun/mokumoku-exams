#!/usr/bin/env node
/**
 * 標準入力の出力から値を伏せて、標準出力に書く。デプロイ前の合成・差分の出力と、保存したデプロイの出力を読むときに通す
 * (デプロイ自体は、確認の問いが出うるので、パイプでつながない。docs/app/lessons/0004-mask-diff-output.md)。
 * 伏せる形は scripts/lib/output-mask.ts(検査の正規表現、リポジトリ直下の .env の値、拒否リストの語)。
 * 伏せたあとも検査に掛かる行は出さない。件数だけを標準エラーに書く。進み具合が見えるよう、1 行ずつ書く。
 *
 *   npm run diff -w @mokumoku-exams/infra -- --all 2>&1 | npm run -s mask
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { parseEnv } from "node:util";
import { denylistCandidates, loadDenylist, MISSING_MESSAGE, resolveDenylist } from "./lib/local-denylist.ts";
import { envValues, maskLine, maskValues } from "./lib/output-mask.ts";

let env: Record<string, string> = {};
try {
  env = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8")) as Record<string, string>;
} catch (error) {
  // .env が無いときは(作業ツリーには複製されない)、正規表現と拒否リストだけで伏せ、そのことを知らせる
  if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  process.stderr.write(".env がないので、.env の値は伏せていません(正規表現と拒否リストの語だけで伏せます)\n");
}

const input = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

const git = (args: string[]): string | null => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
};
const denylist = resolveDenylist(
  loadDenylist(
    denylistCandidates(
      git(["rev-parse", "--show-toplevel"]),
      git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    ),
    (p) => readFileSync(p, "utf8"),
  ),
  process.env,
);
if (denylist === null) {
  // 伏せきれない出力は出さない。パイプの上流が書き込み先を失って止まらないよう、標準入力は最後まで読み捨てる
  process.stderr.write(`${MISSING_MESSAGE}\n`);
  for await (const _ of input) {
    // 読み捨てる
  }
  process.exit(1);
}

if (denylist.length === 0) process.stderr.write("拒否リストの語がないので、拒否リストの語は伏せていません\n");
const values = maskValues(envValues(env), denylist);
let masked = 0;
let dropped = 0;
for await (const line of input) {
  const result = maskLine(line, values);
  if (result.leaked) {
    dropped++;
    continue;
  }
  if (result.masked) masked++;
  process.stdout.write(`${result.text}\n`);
}
process.stderr.write(`値を伏せた行 ${masked} 件、伏せきれずに出さなかった行 ${dropped} 件\n`);
