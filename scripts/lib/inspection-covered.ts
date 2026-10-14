import { execFileSync } from "node:child_process";
import { git } from "./git-check.ts";
import {
  isCovered,
  isReusable,
  ledgerPath,
  patchIdOf,
  readLedger,
  requiredKinds,
  rulesHash,
} from "./inspection-ledger.ts";
import { findDenylistPaths } from "./local-denylist.ts";

/**
 * 範囲のうち、検査済みで読み直さなくてよいコミット(マージを除く)を、古い順に返す。
 * 台帳が読めないなどで判定できないときは例外を投げる。呼び出し側は、すべて読み直す。
 */
export function coveredCommits(range: string, root: string): string[] {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim();
  const ledger = readLedger(ledgerPath(common));
  const rules = rulesHash(root, findDenylistPaths());
  const covered: string[] = [];
  for (const sha of git(["rev-list", "--reverse", "--no-merges", range]).split("\n").filter(Boolean)) {
    const diff = git(["show", "--format=", "--patch", sha]);
    const patchId = patchIdOf(diff);
    const files = git(["show", "--format=", "--name-only", sha]).split("\n").filter(Boolean);
    if (patchId && isReusable(diff) && isCovered(ledger, patchId, requiredKinds(files), rules)) covered.push(sha);
  }
  return covered;
}
