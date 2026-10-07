import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDenylist } from "./pr-secrets-check.mjs";

/**
 * リポジトリ直下の .pr-secrets-denylist(gitignore 済み)を読む。個人固有の語を
 * リポジトリに入れずに検査するための、手元だけのファイル。無ければ空。
 */
export function readLocalDenylist() {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return parseDenylist(readFileSync(join(root, ".pr-secrets-denylist"), "utf8"));
  }
  catch {
    return [];
  }
}
