#!/usr/bin/env node
/**
 * packages/pipeline が、アプリなど他のワークスペースの内部に依存していないかの検査。
 *   node scripts/check-pipeline-boundary.ts
 * 違反があれば終了コード 1(場所と種類だけを出す)。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPipelineBoundary, PIPELINE_ROOT } from "./lib/pipeline-boundary-check.ts";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

const files = sourceFiles(PIPELINE_ROOT).map((path) => ({ path, text: readFileSync(path, "utf8") }));
const violations = checkPipelineBoundary(files);
for (const v of violations) process.stderr.write(`${v.file}:${v.line} ${v.kind}\n`);
if (violations.length > 0) {
  process.stderr.write(`境界の違反: ${violations.length} 件\n`);
  process.exit(1);
}
process.stdout.write(`境界の検査: 違反なし(${files.length} ファイル)\n`);
