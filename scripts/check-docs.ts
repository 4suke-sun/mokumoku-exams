#!/usr/bin/env node
/**
 * 文書の参照の検査。
 *   node scripts/check-docs.ts
 * 相対リンクの先が実在すること、`npm run <名前>` のスクリプトが実在することを確かめる。
 * 失敗したら終了コード 1(場所と種類だけを報告する)。
 */
import { existsSync, readFileSync } from "node:fs";
import { checkLinks, checkNpmRuns, DOC_PATTERNS, type ScriptSets } from "./lib/docs-check.ts";
import { git, report } from "./lib/git-check.ts";

function scriptNames(packagePath: string): { name: string; scripts: Set<string> } {
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; scripts?: Record<string, string> };
  return { name: pkg.name ?? "", scripts: new Set(Object.keys(pkg.scripts ?? {})) };
}

const blocks: string[] = [];
try {
  const paths = git(["ls-files", "--", ...DOC_PATTERNS])
    .split("\n")
    .filter((p) => p !== "");
  const files = paths.map((file) => ({ file, text: readFileSync(file, "utf8") }));

  const scripts: ScriptSets = { root: scriptNames("package.json").scripts, workspaces: new Map() };
  for (const p of git(["ls-files", "--", "packages/*/package.json"]).split("\n")) {
    if (p === "") continue;
    const { name, scripts: set } = scriptNames(p);
    scripts.workspaces.set(name, set);
    scripts.workspaces.set(p.replace(/\/package\.json$/, ""), set);
  }

  blocks.push(...checkLinks(files, existsSync), ...checkNpmRuns(files, scripts));
} catch {
  blocks.push("文書を検査できませんでした(読み込みに失敗)");
}

report(
  "文書の参照の検査に失敗しました。",
  blocks,
  [],
  "リンク先と npm run のスクリプト名を、実在するものに直してください。",
);
