#!/usr/bin/env node
/**
 * ルートの scripts と、すべてのワークスペースのテストを、途中で失敗しても止めずに最後まで流し、ワークスペースごとの結果をまとめて出す。
 *   node scripts/test-all.ts
 * 1 つでも失敗したら、終了コード 1 で終わる(失敗した段階は、すべて挙げる)。E2E は含めない。
 * 段階の定義は scripts/lib/test-all-plan.ts。
 */
import { spawnSync } from "node:child_process";
import { buildTestStages, formatSummary, runAllStages } from "./lib/test-all-plan.ts";

const results = runAllStages(
  buildTestStages(),
  (stage) => {
    process.stdout.write(`\n=== ${stage.name} ===\n`);
    const result = spawnSync(stage.command, stage.args, { stdio: "inherit" });
    if (result.error) process.stderr.write(`${stage.name} を起動できませんでした: ${result.error.message}\n`);
    return result.status === 0;
  },
  Date.now,
);
process.stdout.write(`\n${formatSummary(results)}`);
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
