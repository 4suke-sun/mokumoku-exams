#!/usr/bin/env node
/**
 * 手元の検査を、PR の前にまとめて通す。
 *   node scripts/verify.ts
 * lint、型検査、CI の check ジョブと同じ check:*(scripts/lib/verify-plan.ts の CHECK_SCRIPTS)、validate:data、関係するテスト、関係する build を順に実行し、失敗した段階の名前を示して
 * 終了コード 1 で止まる。段階ごとの時間も表示する(遅い・止まる段階の切り分けのため)。
 * 関係するワークスペースは、`origin/main` との差分と、未コミット・未追跡の変更から選ぶ(CI と同じ規則)。
 * 段階ごとの時間は、手元の計測(node scripts/metrics.ts)のために記録する。
 * E2E(npm run test:e2e)は含めない。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { git } from "./lib/git-check.ts";
import { metricsPath, serializeMetric } from "./lib/metrics.ts";
import { buildStages, formatResult, selectWorkspaces } from "./lib/verify-plan.ts";

function changedFiles(): string[] | null {
  try {
    const lines = [
      ...git(["diff", "--name-only", "--no-renames", "origin/main...HEAD"]).split("\n"),
      ...git(["diff", "--name-only", "--no-renames", "HEAD"]).split("\n"),
      ...git(["ls-files", "--others", "--exclude-standard"]).split("\n"),
    ];
    return [...new Set(lines.filter((l) => l !== ""))];
  } catch {
    return null; // origin/main がないなど。変更が分からないときは、すべて対象にする
  }
}

/** 段階ごとの時間を、手元の計測(.git の共有領域。リポジトリには入らない)へ足す。記録できなくても、検査の結果には影響しない。 */
function recordTimings(stages: { name: string; ms: number; ok: boolean }[]): void {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8",
    }).trim();
    appendFileSync(metricsPath(common), serializeMetric({ type: "verify", at: new Date().toISOString(), stages }));
  } catch {
    // 計測は任意。記録できないときは何もしない
  }
}

const changed = changedFiles();
const selection = selectWorkspaces(changed);
process.stdout.write(
  `対象: ${changed === null ? "変更が分からないため、すべて" : `変更 ${changed.length} 件`}` +
    `(app=${selection.app} infra=${selection.infra} pipeline=${selection.pipeline})\n`,
);

const results: { name: string; ms: number; ok: boolean }[] = [];
for (const stage of buildStages(selection)) {
  process.stdout.write(`\n=== ${stage.name} ===\n`);
  const start = Date.now();
  const result = spawnSync(stage.command, stage.args, { stdio: "inherit" });
  if (result.error) process.stderr.write(`${stage.name} を起動できませんでした: ${result.error.message}\n`);
  const ok = result.status === 0;
  results.push({ name: stage.name, ms: Date.now() - start, ok });
  if (!ok) break;
}
process.stdout.write(`\n${formatResult(results)}`);
recordTimings(results);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
