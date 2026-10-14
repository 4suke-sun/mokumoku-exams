#!/usr/bin/env node
/**
 * PR の `Closes` の Issue と、マイルストーン・リリースノートの版の対応の検査。
 *   node scripts/check-pr-closes.ts --pr <PR の番号>          PR の本文を読む(CI で使う)
 *   node scripts/check-pr-closes.ts --body-file <下書きのファイル>   PR の下書きの本文を読む(投稿の前に使う。1 行目はタイトル)
 * Issue とマイルストーンは `gh` で読む(読み取りだけ)。失敗したら終了コード 1。引数が不正なら 2。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { report } from "./lib/git-check.ts";
import { checkPrCloses, type PrClosesInput, parseCloses, targetVersion } from "./lib/pr-closes-check.ts";

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

const args = process.argv.slice(2);
const mode = args[0];
const value = args[1];
if (
  args.length !== 2 ||
  (mode !== "--pr" && mode !== "--body-file") ||
  !value ||
  (mode === "--pr" && !/^\d+$/.test(value))
) {
  process.stderr.write("使い方: node scripts/check-pr-closes.ts --pr <番号(数字)> | --body-file <下書き>\n");
  process.exit(2);
}

const blocks: string[] = [];
try {
  const body =
    mode === "--pr" ? gh(["pr", "view", value, "--json", "body", "--jq", ".body"]) : readFileSync(value, "utf8");
  const closes = parseCloses(body);

  const milestones: Record<number, string | null> = {};
  for (const n of closes) {
    const title = gh(["issue", "view", String(n), "--json", "milestone", "--jq", ".milestone.title // empty"]).trim();
    milestones[n] = title === "" ? null : title;
  }

  const releases = JSON.parse(
    readFileSync(fileURLToPath(new URL("../data/release-notes.json", import.meta.url)), "utf8"),
  ) as { releases: { version: string }[] };
  const input: PrClosesInput = {
    closes,
    milestones,
    latestRelease: releases.releases[0]?.version ?? null,
    milestone: null,
  };
  const version = targetVersion(input);
  if (version !== null) {
    // 存在しないマイルストーンで `issue list` が失敗しないよう、先に存在を確かめる
    const exists = gh([
      "api",
      "--paginate",
      "repos/{owner}/{repo}/milestones?state=all&per_page=100",
      "--jq",
      ".[].title",
    ])
      .split("\n")
      .includes(version);
    if (exists) {
      const open = JSON.parse(
        gh(["issue", "list", "--milestone", version, "--state", "open", "--limit", "200", "--json", "number"]),
      ) as { number: number }[];
      input.milestone = { title: version, openIssues: open.map((i) => i.number) };
    }
  }
  blocks.push(...checkPrCloses(input));
} catch {
  blocks.push(
    "Closes とマイルストーンを検査できませんでした(gh の読み取り、または下書きとリリースノートの読み込みに失敗)",
  );
}

report(
  "PR の Closes とマイルストーン・リリースノートの対応の検査に失敗しました。",
  blocks,
  [],
  "Closes の Issue、マイルストーン、data/release-notes.json の最新の版をそろえてください。",
);
