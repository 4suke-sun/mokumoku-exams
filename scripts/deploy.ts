#!/usr/bin/env node
/**
 * Release のあとの、デプロイまでの手順(スキル: .claude/skills/dev-deploy)。
 *   node scripts/deploy.ts <版>           前提 → 要否 → 静的な確認 → 差分 → 関門(承認待ち)。デプロイのコマンドを表示して終わる
 *   node scripts/deploy.ts <版> --after   デプロイのあと: 前提 → 人が確かめる項目の一覧
 * デプロイ自体は、確認の問いが出うるので、人が自分の端末で実行する(docs/app/lessons/0004-mask-diff-output.md)。
 * 出力はすべて `npm run -s mask` を通す。記録には、場所と種類だけを書き、値は載せない。再実行してよい(状態は持たない)。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canContinue,
  checkPrerequisites,
  DEPLOY_COMMAND,
  type DeployStep,
  diffHash,
  diffStepStatus,
  formatDeployTable,
  formatDiffSummary,
  humanChecklist,
  judgeDeployNeed,
  latestVersionTag,
  previousTag,
  summarizeDiff,
} from "./lib/deploy-plan.ts";
import { git } from "./lib/git-check.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}.drafts/deploy/`;

const args = process.argv.slice(2);
const version = args[0] ?? "";
const after = args.includes("--after");
if (!/^v\d+\.\d+\.\d+$/.test(version) || args.length > 2 || args.some((a, i) => i > 0 && a !== "--after")) {
  process.stderr.write("使い方: node scripts/deploy.ts <版 vX.Y.Z> [--after]\n");
  process.exit(2);
}

const results: DeployStep[] = [];
const finish = (): never => {
  process.stdout.write(`\n${formatDeployTable(results)}\n`);
  process.exit(canContinue(results) ? 0 : 1);
};
/** 結果を記録して表示する。失敗なら、ここで止まる。 */
const record = (name: string, status: DeployStep["status"], note: string): void => {
  results.push({ name, status, note });
  process.stdout.write(`- ${name}: ${note}\n`);
  if (status === "fail") finish();
};

const tryGit = (a: string[]): string | null => {
  try {
    return git(a).trim();
  } catch {
    return null;
  }
};

/** コマンドを、標準エラーも合わせて `mask` に通して実行する。終了コード(pipefail)と、伏せた出力を返す。 */
function runMasked(command: string): { code: number; text: string } {
  const result = spawnSync("bash", ["-c", `set -o pipefail; ${command} 2>&1 | npm run -s mask`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { code: result.status ?? 1, text: result.stdout ?? "" };
}

function awsAuthorized(): boolean | null {
  const result = spawnSync("aws", ["sts", "get-caller-identity"], { stdio: "ignore", cwd: root });
  if (result.error) return null;
  return result.status === 0;
}

function latestTag(): string {
  return latestVersionTag((tryGit(["tag", "--list", "v*"]) ?? "").split("\n").filter(Boolean));
}

function prerequisites(): void {
  const errors = checkPrerequisites({
    version,
    tagCommit: tryGit(["rev-list", "-n", "1", `refs/tags/${version}`]),
    headCommit: tryGit(["rev-parse", "HEAD"]) ?? "",
    dirty: (tryGit(["status", "--porcelain"]) ?? "x") !== "",
    latestTag: latestTag(),
    envFileExists: existsSync(`${root}.env`),
    envTracked: (tryGit(["ls-files", ".env"]) ?? "") !== "",
    awsAuthorized: after ? true : awsAuthorized(),
  });
  if (errors.length > 0) record("前提の確認", "fail", errors.join(" / "));
  record("前提の確認", "ok", "最新のタグのコミットで、変更がなく、.env がある");
}

mkdirSync(out, { recursive: true });
prerequisites();

if (after) {
  const doc = readFileSync(`${root}docs/post-deploy-smoke.md`, "utf8");
  const items = humanChecklist(doc);
  record(
    "人の確認の一覧",
    "wait",
    `docs/post-deploy-smoke.md の「3. 確認する流れ」の ${items.length} 項目を、人が確かめる`,
  );
  for (const item of items) process.stdout.write(`  - ${item}\n`);
  process.stdout.write("  - デプロイした版(アプリが版を返さないため、画面のリリースノートの先頭で確かめる)\n");
  finish();
}

// 要否の判定: 前の版のタグとの差分のパス
const tags = (tryGit(["tag", "--list", "v*"]) ?? "").split("\n").filter(Boolean);
const previous = previousTag(tags, version);
if (previous === null) record("要否の判定", "ok", "最初の版のため、デプロイが要る");
else {
  const files = (tryGit(["diff", "--name-only", "--no-renames", `${previous}..${version}`]) ?? "")
    .split("\n")
    .filter(Boolean);
  const need = judgeDeployNeed(files);
  if (!need.needed) {
    record("要否の判定", "skip", `${previous} からの変更に、デプロイへ影響するパスがない。デプロイは不要`);
    finish();
  }
  record(
    "要否の判定",
    "ok",
    need.releaseNotesOnly
      ? `影響は data/release-notes.json だけ(画面に版のタイトルが出る)。省くなら、ここで止める(次の版でまとめて出る)`
      : `${previous} から、影響するパスが ${need.count} 件`,
  );
}

// 静的な確認: docs/pre-deploy-checklist.md の、機械で確かめられる項目
const STATIC: [string, string][] = [
  ["環境変数の契約", "npm run check:env"],
  ["lint", "npm run lint"],
  ["型検査", "npm run typecheck"],
  ["テスト", "npm test"],
  ["ビルド", "npm run build"],
  ["Lambda の成果物", "npm run build:lambda"],
  ["非公開の問題の混入", "npm run check:unpublished-bundle"],
];
for (const [index, [name, command]] of STATIC.entries()) {
  const run = runMasked(command);
  writeFileSync(`${out}static-${index + 1}.log`, run.text);
  if (run.code !== 0) record(`静的な確認: ${name}`, "fail", `${command} が失敗(伏せた出力は .drafts/deploy/ に保存)`);
}
record("静的な確認", "ok", `${STATIC.length} 項目が通った`);

// 差分: 伏せた出力だけを読む
const diff = runMasked("npm run diff -w @mokumoku-exams/infra -- --all");
writeFileSync(`${out}diff.masked.txt`, diff.text);
if (diff.code !== 0) record("差分", "fail", "差分の確認が失敗(伏せた出力は .drafts/deploy/diff.masked.txt)");
const summary = summarizeDiff(diff.text);
record(
  "差分",
  diffStepStatus(summary),
  `${summary.understood ? "" : "形を解釈できないため、全文を読む。"}要約(全文は .drafts/deploy/diff.masked.txt、ハッシュ ${diffHash(diff.text).slice(0, 12)})`,
);
for (const line of formatDiffSummary(summary)) process.stdout.write(`  - ${line}\n`);

// 関門: 人の承認を待つ。デプロイは人が自分の端末で実行する
record("関門", "wait", "差分の要約を人が確かめ、承認する");
record("デプロイ", "wait", `承認のあと、人が自分の端末で実行する: ${DEPLOY_COMMAND}(出力は記録に載せない)`);
process.stdout.write(`\nデプロイが終わったら: node scripts/deploy.ts ${version} --after\n`);
finish();
