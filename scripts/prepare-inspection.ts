#!/usr/bin/env node
/**
 * 検査役に読ませるファイルを .drafts/inspect/ に書き出す。
 *   node scripts/prepare-inspection.ts --cached            ステージした差分(commit)
 *   node scripts/prepare-inspection.ts --range <範囲>       範囲の全コミットの差分(push。例: origin/main..HEAD)
 *   node scripts/prepare-inspection.ts --pr [<基準>]        基準との差分と全コミット(PR。既定は origin/main)
 *   node scripts/prepare-inspection.ts --clean             書き出したファイルを消す
 */
import { cleanInspection, INSPECT_DIR, type InspectionMode, prepareInspection } from "./lib/inspection-input.ts";

const [flag, value] = process.argv.slice(2);
const root = process.cwd();

const modes: Record<string, InspectionMode | undefined> = {
  "--cached": { kind: "cached" },
  "--range": value ? { kind: "range", range: value } : undefined,
  "--pr": { kind: "pr", base: value ?? "origin/main" },
};

try {
  if (flag === "--clean") {
    cleanInspection(root);
  } else if (flag && modes[flag]) {
    const written = prepareInspection(modes[flag], root);
    process.stdout.write(`${written.map((name) => `${INSPECT_DIR}/${name}`).join("\n")}\n`);
  } else {
    process.stderr.write(
      "使い方: node scripts/prepare-inspection.ts --cached | --range <範囲> | --pr [<基準>] | --clean\n",
    );
    process.exitCode = 2;
  }
} catch {
  process.stderr.write("検査の入力を書き出せませんでした(git の実行などに失敗)。\n");
  process.exitCode = 1;
}
