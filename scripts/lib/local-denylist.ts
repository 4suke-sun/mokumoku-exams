import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDenylist } from "./pr-secrets-check.ts";

export const DENYLIST_FILE = ".pr-secrets-denylist";

export const MISSING_MESSAGE = [
  `検査を中止しました。拒否リスト(${DENYLIST_FILE})が見つかりません。`,
  "個人固有の語の検査が効かないまま通さないため、手元では止めます。",
  `主の作業ツリーの直下に ${DENYLIST_FILE} を置いてください(gitignore 済み)。`,
  "書式は 1 行 1 語です。# で始まる行はコメント、空行は無視します。語を持たない場合は、コメントだけのファイルで構いません。",
].join("\n");

/**
 * 拒否リストを探す場所の候補を返す。作業ツリーの直下と、主の作業ツリーの直下の順で、重複は除く。
 * gitignore 済みのため、git worktree add した作業ツリーには無く、主の作業ツリーにだけある。
 */
export function denylistCandidates(topLevel: string | null, commonDir: string | null): string[] {
  const paths = [topLevel, commonDir ? dirname(commonDir) : null]
    .filter((dir): dir is string => dir !== null)
    .map((dir) => join(dir, DENYLIST_FILE));
  return [...new Set(paths)];
}

/** 候補を読んで語を合わせる。読めた候補が 1 つも無ければ null(語が 0 個のファイルは、読めたものとして数える)。 */
export function loadDenylist(candidates: string[], read: (path: string) => string): string[] | null {
  let words: string[] | null = null;
  for (const path of candidates) {
    let text: string;
    try {
      text = read(path);
    } catch {
      continue;
    }
    words = [...(words ?? []), ...parseDenylist(text)];
  }
  return words;
}

/**
 * 見つからないときの扱い。CI にはリストを置かないので空で続け、手元では null(止める)にする。
 */
export function resolveDenylist(words: string[] | null, env: { CI?: string }): string[] | null {
  if (words !== null) return words;
  return env.CI ? [] : null;
}

function gitPath(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** 拒否リストの置き場を、読めるものから順に返す(検査役に、読むべきファイルを渡すために使う)。無ければ空。 */
export function findDenylistPaths(): string[] {
  const candidates = denylistCandidates(
    gitPath(["rev-parse", "--show-toplevel"]),
    gitPath(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  return candidates.filter((path) => loadDenylist([path], (p) => readFileSync(p, "utf8")) !== null);
}

/**
 * 拒否リスト(gitignore 済み。個人固有の語をリポジトリに入れずに検査するための、手元だけのファイル)を読む。
 * 手元で見つからないときは、置き場と書式を案内して終了コード 1 で止める(検査が効かないまま通さない)。
 */
export function readLocalDenylist(): string[] {
  const candidates = denylistCandidates(
    gitPath(["rev-parse", "--show-toplevel"]),
    gitPath(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const words = resolveDenylist(
    loadDenylist(candidates, (p) => readFileSync(p, "utf8")),
    process.env,
  );
  if (words === null) {
    process.stderr.write(`${MISSING_MESSAGE}\n`);
    process.exit(1);
  }
  return words;
}
