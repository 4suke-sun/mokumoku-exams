#!/usr/bin/env node
/**
 * Issue の下書きの一覧(マニフェスト)から、新規の起票と既存の Issue の編集をまとめて行う。
 *   node scripts/post-issues.ts <一覧.json> --seal      承認の時点の封印(下書きと、一覧の項目のハッシュ)を、一覧に記録する(承認の直後に行う)。
 *                                                       すでに封印があり、内容が変わっているときは拒否する(承認をやり直して、--reseal で封印し直す)
 *   node scripts/post-issues.ts <一覧.json> --reseal    封印し直す(検査と承認をやり直したあとにだけ使う)
 *   node scripts/post-issues.ts <一覧.json> --dry-run   検査して、投稿する内容の概要を表示する(何も投稿しない。封印は求めない。承認の前に見せるために使う)
 *   node scripts/post-issues.ts <一覧.json>             検査して投稿し、結果(番号・題・URL)を一覧に書き戻して表示する
 * 一覧と下書きは .drafts/(gitignore 済み)に置く。投稿は、承認した内容と封印が一致するときだけ行う。
 * 途中で失敗しても、結果を書き戻した行は、再実行で飛ばす(gh の成功のあと、書き戻しの前に止まった行は、再実行の前に GitHub で重複を確かめる)。
 * 人の承認のあとにだけ実行する(スキル: .claude/skills/dev-pr)。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  checkDraft,
  formatResults,
  ghArgs,
  issueNumberFromUrl,
  type ManifestEntry,
  parseDraft,
  sealInput,
  validateManifest,
  verifySeals,
} from "./lib/issue-manifest.ts";

const args = process.argv.slice(2);
const MODES = ["--seal", "--reseal", "--dry-run"];
if (!args[0] || args.length > 2 || (args[1] !== undefined && !MODES.includes(args[1]))) {
  process.stderr.write("使い方: node scripts/post-issues.ts <一覧.json> [--seal | --reseal | --dry-run]\n");
  process.exit(2);
}
const manifestPath: string = args[0];
const mode = args[1];

const fail = (messages: string[]): never => {
  process.stderr.write(`${messages.map((m) => `- ${m}`).join("\n")}\n`);
  process.exit(1);
};

/** 一覧を、途中で切れても壊れないよう、一時ファイルに書いてから置き換える。 */
function writeManifest(entries: ManifestEntry[]): void {
  const tmp = `${manifestPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`);
  renameSync(tmp, manifestPath);
}

const baseDir = dirname(resolve(manifestPath));
let entries: ManifestEntry[];
try {
  entries = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];
} catch {
  entries = fail(["一覧を読めない(ファイルがない、または JSON の形が正しくない)"]);
}
const manifestErrors = validateManifest(entries);
if (manifestErrors.length > 0) fail(manifestErrors);

const texts: Record<string, string> = {};
const seals: Record<string, string> = {};
const baseReal = realpathSync(baseDir);
for (const e of entries) {
  try {
    const real = realpathSync(join(baseDir, e.file));
    // シンボリックリンクで、一覧のあるディレクトリの外を読まない
    if (!real.startsWith(baseReal + sep)) fail([`${e.file}: 一覧のあるディレクトリの外を指している`]);
    texts[e.file] = readFileSync(real, "utf8");
  } catch {
    fail([`${e.file}: 下書きを読めない`]);
  }
  const fileHash = createHash("sha256")
    .update(texts[e.file] as string)
    .digest("hex");
  seals[e.file] = createHash("sha256").update(sealInput(e, fileHash)).digest("hex");
}
const draftErrors = entries.flatMap((e) => (e.result ? [] : checkDraft(e.file, texts[e.file] as string)));
if (draftErrors.length > 0) fail(draftErrors);

if (mode === "--seal" || mode === "--reseal") {
  // 承認のあとに内容を変えて、承認のやり直しなしに封印し直すことを防ぐ
  const changed = entries.filter((e) => !e.result && e.sha256 !== undefined && e.sha256 !== seals[e.file]);
  if (mode === "--seal" && changed.length > 0) {
    fail([
      ...changed.map((e) => `${e.file}: すでに封印があり、内容が変わっている(検査と承認をやり直してから --reseal)`),
    ]);
  }
  for (const e of entries) {
    if (!e.result) e.sha256 = seals[e.file]; // 投稿済みの行は、封印し直さない
  }
  writeManifest(entries);
  for (const e of entries) process.stdout.write(`${(e.sha256 ?? "(投稿済み)").slice(0, 16)}  ${e.file}\n`);
  process.exit(0);
}

// --dry-run は何も投稿しないので、承認の前に出せるよう、封印を求めない。投稿のときだけ、封印の一致を求める
const sealErrors = mode === "--dry-run" ? [] : verifySeals(entries, seals);
if (sealErrors.length > 0) fail(sealErrors);

const work = mkdtempSync(join(tmpdir(), "post-issues-"));
try {
  for (const e of entries) {
    // 投稿済みの行(結果が書き戻されている)は、再実行で二重に起票しないよう、飛ばす
    if (e.result) {
      process.stdout.write(`省略(投稿済み: ${e.result.number === null ? "#?" : `#${e.result.number}`}) ${e.file}\n`);
      continue;
    }
    const draft = parseDraft(texts[e.file] as string);
    if (!draft) continue; // checkDraft で検査済み
    const bodyFile = join(work, e.file.replace(/[^\w.-]/g, "_"));
    writeFileSync(bodyFile, draft.body);
    const ghCommand = ghArgs(e, draft.title, bodyFile);
    if (mode === "--dry-run") {
      process.stdout.write(
        `gh ${ghCommand.slice(0, 2).join(" ")}${e.number === undefined ? "" : ` ${e.number}`} (${e.file}, milestone=${e.milestone ?? "なし"}, labels=${(e.labels ?? []).join(",")})\n`,
      );
      continue;
    }
    // 応答だけが失敗して、Issue は作られている場合がある。その場合は、再実行の前に、GitHub で重複を確かめる
    const failMessage = `${e.file}: gh の実行に失敗した。再実行の前に、GitHub で同じ題の Issue がないか確かめる(投稿済みの行は、再実行で飛ばす)`;
    const output: string = (() => {
      try {
        return execFileSync("gh", ghCommand, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      } catch {
        return fail([failMessage]);
      }
    })();
    const url = output.trim().split("\n").pop() ?? "";
    // 投稿は成功している。番号を読めなくても、結果を先に書き戻して、再実行での二重の投稿を防ぐ
    e.result = { number: issueNumberFromUrl(output) ?? e.number ?? null, title: draft.title, url };
    writeManifest(entries);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (mode !== "--dry-run") process.stdout.write(`${formatResults(entries)}\n`);
