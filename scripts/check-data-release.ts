#!/usr/bin/env node
/**
 * 配信するデータ(`data/` の JSON。リリースノートと非公開の問題を除く)を変える PR が、新しい版のエントリを伴うかの検査。
 *   node scripts/check-data-release.ts --base <基準のコミット>
 * `<基準>...HEAD` で変わったファイルに配信するデータがあれば、HEAD の data/release-notes.json の先頭の版が、
 * 基準のコミットの先頭の版より新しいことを求める(版とタグは 1:1 なので、基準の先頭の版は、最新のタグにあたる)。
 * 失敗したら終了コード 1。引数が不正なら 2。
 */
import { readFileSync } from "node:fs";
import { checkDataRelease } from "./lib/data-release-check.ts";
import { git, report, tryGit } from "./lib/git-check.ts";

const FILE = "data/release-notes.json";
const args = process.argv.slice(2);
const base = args[1];
if (args.length !== 2 || args[0] !== "--base" || !base) {
  process.stderr.write("使い方: node scripts/check-data-release.ts --base <基準のコミット>\n");
  process.exit(2);
}

const topOf = (text: string): string | null => {
  try {
    return (JSON.parse(text) as { releases?: { version?: string }[] }).releases?.[0]?.version ?? null;
  } catch {
    return null;
  }
};

const blocks: string[] = [];
try {
  // 基準のコミットを解決できないとき(取得していないなど)は、黙って通さず、検査の失敗にする
  git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  const changedFiles = git(["diff", "--name-only", "--no-renames", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean);
  const baseText = tryGit(["show", `${base}:${FILE}`]);
  blocks.push(
    ...checkDataRelease({
      changedFiles,
      baseTop: baseText === "" ? null : topOf(baseText),
      headTop: topOf(readFileSync(FILE, "utf8")),
    }),
  );
} catch {
  blocks.push(
    "配信するデータと版のエントリの対応を検査できませんでした(git の実行、またはリリースノートの読み込みに失敗)",
  );
}

report(
  "配信するデータを変える PR の、版のエントリの検査に失敗しました。",
  blocks,
  [],
  "問題データなどの配信するデータを変える PR も、版単位にします(版のエントリとタグを伴う。CONTRIBUTING.md の「Pull Request」)。",
);
