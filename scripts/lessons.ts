#!/usr/bin/env node
/**
 * 引っかかりの受け箱。手順は docs/lessons-workflow.md。
 *   node scripts/lessons.ts add --key <キー> --who <誰> --cause <原因> --promote <昇格先> --what <起きたこと> --should <本来どうすべきか>
 *   node scripts/lessons.ts list                      種類のキーごとの、対処していない件数
 *   node scripts/lessons.ts repeats [--threshold 2]   繰り返しの種類(しきい値以上)
 *   node scripts/lessons.ts draft [--threshold 2]     繰り返しの種類ごとに、Issue の下書きを .drafts/issues/ に作る(投稿はしない。すでにある下書きは上書きしない)
 *   node scripts/lessons.ts close <キー> <行き先>     種類を対処済みにする(これより前の件は数えない)
 * 受け箱は `.git` の共有領域にあり、作業ツリーをまたいで合算される。起きたことの文章に、値(認証情報など)を書かない。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { git } from "./lib/git-check.ts";
import {
  buildCandidate,
  CAUSES,
  DEFAULT_THRESHOLD,
  findRepeats,
  formatIssueDraft,
  inboxPath,
  isText,
  KEY_PATTERN,
  openByKey,
  PROMOTIONS,
  parseInbox,
  serializeRecord,
  versionOfBranch,
  WHOS,
} from "./lib/lessons-inbox.ts";

const [command, ...rest] = process.argv.slice(2);

function commonDir(): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim();
}

function currentBranch(): string {
  try {
    return git(["branch", "--show-current"]).trim();
  } catch {
    return "";
  }
}

function usage(): void {
  process.stderr.write(
    [
      "使い方:",
      "  node scripts/lessons.ts add --key <キー> --who <誰> --cause <原因> --promote <昇格先> --what <起きたこと> --should <本来どうすべきか>",
      `    who: ${WHOS.join(" | ")}`,
      `    cause: ${CAUSES.join(" | ")}`,
      `    promote: ${PROMOTIONS.join(" | ")}`,
      "  node scripts/lessons.ts list | repeats [--threshold N] | draft [--threshold N] | close <キー> <行き先>",
      "",
    ].join("\n"),
  );
  process.exitCode = 2;
}

function thresholdOf(value: string | undefined): number {
  const n = Number(value ?? DEFAULT_THRESHOLD);
  return Number.isInteger(n) && n >= 2 ? n : DEFAULT_THRESHOLD;
}

try {
  const path = inboxPath(commonDir());
  const records = existsSync(path) ? parseInbox(readFileSync(path, "utf8")) : [];

  if (command === "add") {
    const { values } = parseArgs({
      args: rest,
      options: {
        key: { type: "string" },
        who: { type: "string" },
        cause: { type: "string" },
        promote: { type: "string" },
        what: { type: "string" },
        should: { type: "string" },
      },
    });
    const result = buildCandidate(values, { at: new Date().toISOString(), version: versionOfBranch(currentBranch()) });
    if (!result.ok) {
      process.stderr.write(`受け箱へ足せません。不正な項目: ${result.invalid.join(", ")}\n`);
      usage();
    } else {
      appendFileSync(path, serializeRecord(result.candidate));
      const count = openByKey([...records, result.candidate]).get(result.candidate.key)?.length ?? 1;
      process.stdout.write(`受け箱へ足しました(${result.candidate.key}: 対処していない件数 ${count})\n`);
    }
  } else if (command === "list") {
    const byKey = [...openByKey(records)].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    if (byKey.length === 0) process.stdout.write("対処していない引っかかりはありません\n");
    for (const [key, entries] of byKey) process.stdout.write(`${entries.length}\t${key}\n`);
  } else if (command === "repeats" || command === "draft") {
    const { values } = parseArgs({ args: rest, options: { threshold: { type: "string" } } });
    const repeats = findRepeats(records, thresholdOf(values.threshold));
    if (repeats.length === 0) {
      process.stdout.write("繰り返しの種類はありません\n");
    } else if (command === "repeats") {
      for (const r of repeats) process.stdout.write(`${r.count}\t${r.versions} つの版\t${r.key}\n`);
    } else {
      const dir = join(git(["rev-parse", "--show-toplevel"]).trim(), ".drafts", "issues");
      mkdirSync(dir, { recursive: true });
      for (const r of repeats) {
        const file = join(dir, `lessons-${r.key}.md`);
        try {
          // 排他的に作る(wx)。すでにあるファイル(人が編集した下書き、同名のリンクを含む)は上書きしない
          writeFileSync(file, formatIssueDraft(r), { flag: "wx" });
          process.stdout.write(`下書きを作りました: .drafts/issues/lessons-${r.key}.md(${r.count} 件)\n`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          process.stdout.write(`下書きがすでにあります(上書きしません): .drafts/issues/lessons-${r.key}.md\n`);
        }
      }
      process.stdout.write("投稿はしていません。起票は /dev-pr の検査と承認を経ます。\n");
    }
  } else if (command === "close" && rest[0] && rest[1]) {
    const [key, ref] = rest;
    if (!KEY_PATTERN.test(key) || !openByKey(records).has(key)) {
      process.stderr.write("対処していない種類のキーを指定してください(list で確かめられます)\n");
      process.exitCode = 1;
    } else if (!isText(ref)) {
      process.stderr.write("行き先は、空でなく 200 文字までの 1 行で書いてください\n");
      process.exitCode = 1;
    } else {
      appendFileSync(path, serializeRecord({ type: "closed", at: new Date().toISOString(), key, ref }));
      process.stdout.write(`対処済みにしました(${key})\n`);
    }
  } else {
    usage();
  }
} catch {
  process.stderr.write("受け箱を扱えませんでした(git の実行や読み書きに失敗)。\n");
  process.exitCode = 1;
}
