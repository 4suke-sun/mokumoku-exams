#!/usr/bin/env node
/**
 * 検査役に読ませるファイルを .drafts/inspect/ に書き出す。
 *   node scripts/prepare-inspection.ts --cached            ステージした差分(commit。公開済みのコミットを取り込むマージの途中は、競合を解消した部分だけ。公開済みの内容は covered.txt に挙げる)
 *   node scripts/prepare-inspection.ts --range <範囲>       範囲の全コミットの差分(push。例: origin/main..HEAD)
 *   node scripts/prepare-inspection.ts --pr [<基準>]        基準との差分と全コミット(PR。既定は origin/main)
 *   node scripts/prepare-inspection.ts --verify <スタンプ>  検査役の報告のスタンプが、いまの入力と一致するかを確かめる(違えば終了コード 1)
 *   node scripts/prepare-inspection.ts --clean             書き出したファイルを消す
 * 書き出したときの最後の行に、入力のスタンプ(`スタンプ: …`)を出す。検査役は、報告にそれを書き写す。
 */
import {
  cleanInspection,
  INSPECT_DIR,
  type InspectionMode,
  prepareInspection,
  verifyInspection,
} from "./lib/inspection-input.ts";

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
  } else if (flag === "--verify" && value) {
    const result = verifyInspection(value, root);
    if (result.ok) {
      process.stdout.write("スタンプが一致しました\n");
    } else {
      process.stderr.write(`${result.reason}。入力を書き出し直して、検査をやり直してください。\n`);
      process.exitCode = 1;
    }
  } else if (flag && modes[flag]) {
    const { names, stamp } = prepareInspection(modes[flag], root);
    process.stdout.write(`${names.map((name) => `${INSPECT_DIR}/${name}`).join("\n")}\nスタンプ: ${stamp}\n`);
  } else {
    process.stderr.write(
      "使い方: node scripts/prepare-inspection.ts --cached | --range <範囲> | --pr [<基準>] | --verify <スタンプ> | --clean\n",
    );
    process.exitCode = 2;
  }
} catch {
  process.stderr.write("検査の入力を書き出せませんでした(git の実行などに失敗)。\n");
  process.exitCode = 1;
}
