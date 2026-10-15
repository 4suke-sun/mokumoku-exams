#!/usr/bin/env node
/**
 * アプリが読む環境変数と、CDK が Lambda へ渡す環境変数の対応の検査。
 *   node scripts/check-env-contract.ts
 * 渡されない変数があると、場所と名前を示して失敗する(終了コード 1)。
 */
import { readFileSync } from "node:fs";
import { checkEnvContract, extractAppEnvReads, extractCdkEnvNames } from "./lib/env-contract-check.ts";
import { git, report } from "./lib/git-check.ts";

const blocks: string[] = [];
try {
  const read = (file: string) => ({ file, text: readFileSync(file, "utf8") });
  // アプリのソースと設定。テストは対象にしない(テストの環境変数は、実行時に Lambda から読まれない)
  const appFiles = git([
    "ls-files",
    "--",
    "packages/app/src/*.ts",
    "packages/app/src/*.tsx",
    "packages/app/*.ts",
    "packages/app/*.mjs",
  ])
    .split("\n")
    .filter((f) => f !== "" && !/\.(test|spec)\.tsx?$/.test(f) && !f.startsWith("packages/app/e2e/"));
  const reads = extractAppEnvReads(appFiles.map(read));
  const passed = extractCdkEnvNames(read("packages/infra/lib/web-stack.ts"), [
    read("packages/infra/lib/push-stack.ts"),
  ]);
  if (passed.size === 0) blocks.push("packages/infra/lib/web-stack.ts: Lambda の環境変数の指定を読み取れない");
  blocks.push(...checkEnvContract(reads, passed));
} catch {
  blocks.push("環境変数の対応を検査できませんでした(読み込みに失敗)");
}

report(
  "環境変数の対応の検査に失敗しました。",
  blocks,
  [],
  "packages/infra/lib/web-stack.ts の environment に変数を足すか、scripts/lib/env-contract-check.ts の除外の一覧に理由つきで足してください。",
);
