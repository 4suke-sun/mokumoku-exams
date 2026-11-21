#!/usr/bin/env node
/**
 * 引っかかりの受け箱。手順は docs/lessons-workflow.md。
 *   node scripts/lessons.ts add --key <キー> --who <誰> --cause <原因> --promote <昇格先> --what <起きたこと> --should <本来どうすべきか>
 *   node scripts/lessons.ts list                      種類のキーごとの、対処していない件数
 *   node scripts/lessons.ts repeats [--threshold 2]   繰り返しの種類(しきい値以上)
 *   node scripts/lessons.ts draft [--threshold 2] [--manifest manifest-<用途>.json]
 *                                                     繰り返しの種類ごとに、Issue の下書きを .drafts/issues/ に作る(投稿はしない。すでにある下書きは上書きしない)。
 *                                                     作った下書きの項目(新規、ラベル lessons)を、一覧 .drafts/issues/<一覧の名前> に足す(既定は manifest-lessons.json。
 *                                                     名前は用途ごとの別名の形だけ。すでにある項目は書き換えない。マイルストーンは起票の場で決める)
 *   node scripts/lessons.ts close <キー> <行き先>     種類を対処済みにする(これより前の件は数えない)
 *   node scripts/lessons.ts closed                    対処済みにした種類の、キーと行き先と日付(読み取りだけ。対処していない種類は出さない)
 * 受け箱は `.git` の共有領域にあり、作業ツリーをまたいで合算される。起きたことの文章に、値(認証情報など)を書かない。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { git } from "./lib/git-check.ts";
import { isManifestName } from "./lib/issue-manifest.ts";
import {
  addDraftEntries,
  buildCandidate,
  CAUSES,
  closedMarks,
  DEFAULT_THRESHOLD,
  draftFileName,
  findRepeats,
  formatIssueDraft,
  inboxPath,
  isText,
  KEY_PATTERN,
  LESSONS_LABEL,
  LESSONS_MANIFEST,
  openByKey,
  PROMOTIONS,
  parseInbox,
  serializeRecord,
  versionOfBranch,
  WHOS,
} from "./lib/lessons-inbox.ts";

const [command, ...rest] = process.argv.slice(2);

function commonDir(): string {
  return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
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
      "  node scripts/lessons.ts list | repeats [--threshold N] | draft [--threshold N] [--manifest manifest-<用途>.json] | close <キー> <行き先> | closed",
      "",
    ].join("\n"),
  );
  process.exitCode = 2;
}

/**
 * 作った下書きの項目を、一覧(既定は manifest-lessons.json)に足す。一覧がなければ作る。すでに同じ file の項目があれば、書き換えない。
 * 一覧を読めないときは、足さずに終了コード 1 にする(人が書いた一覧を、壊さない)。
 */
function addToManifest(dir: string, name: string, files: string[]): void {
  const path = join(dir, name);
  let current: unknown = [];
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      current = null;
    }
  }
  const result = addDraftEntries(current, files);
  if (result === null) {
    process.stderr.write(
      `一覧(.drafts/issues/${name})を読めないため、項目を足していません。一覧を直して、手で足してください。\n`,
    );
    process.exitCode = 1;
    return;
  }
  if (result.added.length > 0) {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(result.entries, null, 2)}\n`);
    renameSync(tmp, path);
    process.stdout.write(
      `一覧(.drafts/issues/${name})に足しました(ラベル ${LESSONS_LABEL}。マイルストーンは起票の場で決めます): ${result.added.join(", ")}\n`,
    );
  }
  if (result.skipped.length > 0) {
    process.stdout.write(`一覧にすでに項目があります(書き換えません): ${result.skipped.join(", ")}\n`);
  }
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
    const { values } = parseArgs({
      args: rest,
      options: { threshold: { type: "string" }, manifest: { type: "string" } },
    });
    const manifestName = values.manifest ?? LESSONS_MANIFEST;
    const repeats = findRepeats(records, thresholdOf(values.threshold));
    if (command === "repeats" && values.manifest !== undefined) {
      process.stderr.write("--manifest は draft だけで使えます\n");
      process.exitCode = 2;
    } else if (command === "draft" && !isManifestName(manifestName)) {
      // 並行するセッションと一覧が重ならないよう、用途ごとの別名だけを受け付ける(既定の manifest.json は使わない)
      process.stderr.write(
        "一覧の名前は、用途ごとの別名(manifest-<用途>.json。用途は英小文字・数字・ハイフン)にしてください\n",
      );
      process.exitCode = 2;
    } else if (repeats.length === 0) {
      process.stdout.write("繰り返しの種類はありません\n");
    } else if (command === "repeats") {
      for (const r of repeats) process.stdout.write(`${r.count}\t${r.versions} つの版\t${r.key}\n`);
    } else {
      const dir = join(git(["rev-parse", "--show-toplevel"]).trim(), ".drafts", "issues");
      mkdirSync(dir, { recursive: true });
      const created: string[] = [];
      for (const r of repeats) {
        const name = draftFileName(r.key);
        try {
          // 排他的に作る(wx)。すでにあるファイル(人が編集した下書き、同名のリンクを含む)は上書きしない
          writeFileSync(join(dir, name), formatIssueDraft(r), { flag: "wx" });
          created.push(name);
          process.stdout.write(`下書きを作りました: .drafts/issues/${name}(${r.count} 件)\n`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          process.stdout.write(`下書きがすでにあります(上書きしません): .drafts/issues/${name}\n`);
        }
      }
      // 作った下書きだけを一覧に足す(すでにある下書きは、投稿済みかもしれないので、足し直さない)
      if (created.length > 0) addToManifest(dir, manifestName, created);
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
  } else if (command === "closed") {
    const marks = closedMarks(records);
    if (marks.length === 0) process.stdout.write("対処済みにした種類はありません\n");
    for (const mark of marks) process.stdout.write(`${mark.key}\t${mark.ref}\t${mark.date}\n`);
  } else {
    usage();
  }
} catch {
  process.stderr.write("受け箱を扱えませんでした(git の実行や読み書きに失敗)。\n");
  process.exitCode = 1;
}
