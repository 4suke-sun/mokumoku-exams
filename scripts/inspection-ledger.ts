#!/usr/bin/env node
/**
 * 検査済みの差分の台帳。commit のときに検査した差分を記録し、push と PR の検査で読み直さないために使う。
 *   node scripts/inspection-ledger.ts record <コミット> <種類[,種類]> <OK|WARN|BLOCK>
 *   node scripts/inspection-ledger.ts covered <範囲>      検査済みで読み直さなくてよいコミットを、1 行に 1 つ出す
 */
import { execFileSync } from "node:child_process";
import { git } from "./lib/git-check.ts";
import { coveredCommits } from "./lib/inspection-covered.ts";
import {
  addEntries,
  isReusable,
  KINDS,
  type Kind,
  ledgerPath,
  patchIdOf,
  readLedger,
  rulesHash,
  VERDICTS,
  type Verdict,
  writeLedger,
} from "./lib/inspection-ledger.ts";
import { findDenylistPaths } from "./lib/local-denylist.ts";

const [command, a, b, c] = process.argv.slice(2);

function commitPatch(rev: string): string {
  return git(["show", "--format=", "--patch", rev]);
}

const root = git(["rev-parse", "--show-toplevel"]).trim();
const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
  encoding: "utf8",
}).trim();
const path = ledgerPath(common);
const rules = rulesHash(root, findDenylistPaths());

try {
  if (command === "record" && a && b && c) {
    const kinds = b.split(",") as Kind[];
    if (!kinds.every((k) => KINDS.includes(k)) || !VERDICTS.includes(c as Verdict)) throw new Error("引数が不正です");
    const diff = commitPatch(a);
    const patchId = patchIdOf(diff);
    if (!patchId || !isReusable(diff)) {
      process.stdout.write("台帳に記録しません(空、またはバイナリを含む差分。push と PR の検査で読み直します)\n");
    } else {
      const entries = kinds.map((kind) => ({ patchId, kind, verdict: c as Verdict, rules }));
      writeLedger(path, addEntries(readLedger(path), entries));
      process.stdout.write(`台帳に記録しました(${kinds.join(",")}: ${c})\n`);
    }
  } else if (command === "covered" && a) {
    for (const sha of coveredCommits(a, root)) process.stdout.write(`${sha}\n`);
  } else {
    process.stderr.write(
      "使い方: node scripts/inspection-ledger.ts record <コミット> <種類[,種類]> <OK|WARN|BLOCK> | covered <範囲>\n",
    );
    process.exitCode = 2;
  }
} catch {
  process.stderr.write("台帳を扱えませんでした(git の実行などに失敗)。差分は、すべて読み直してください。\n");
  process.exitCode = 1;
}
