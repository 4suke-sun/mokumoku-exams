#!/usr/bin/env node
/**
 * 非公開の問題(data/unpublished.<コード>.json)が、アプリのビルド成果物に含まれないことの検査(CI で、build のあとに回す)。
 *   node scripts/check-unpublished-bundle.ts <データのフォルダ> <ビルド成果物のフォルダ>...
 * 非公開の問題がなければ、何も検査せず成功にする。ある場合に、成果物のフォルダが 1 つもなければ、失敗にする(検査できないまま通さない)。
 * 失敗したら終了コード 1。引数が不正なら 2。報告は、ファイルのパスと問題の ID だけ(本文は出さない)。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib/git-check.ts";
import { leakedIds, type Probe, probesOf } from "./lib/unpublished-bundle-check.ts";

const [dataDir, ...buildDirs] = process.argv.slice(2);
if (dataDir === undefined || buildDirs.length === 0) {
  process.stderr.write(
    "使い方: node scripts/check-unpublished-bundle.ts <データのフォルダ> <ビルド成果物のフォルダ>...\n",
  );
  process.exit(2);
}

/** 1 ファイルの読み込みの上限。これを超えるファイルは、バイナリや大きな資産とみなして読まない */
const MAX_BYTES = 64 * 1024 * 1024;

/** 読まずに飛ばしたもの(シンボリックリンクなどの通常のファイルでないもの、上限を超える大きなファイル)の数 */
let skipped = 0;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
    else skipped++;
  }
}

const blocks: string[] = [];
try {
  const probes: Probe[] = readdirSync(dataDir)
    .filter((n) => /^unpublished\..+\.json$/.test(n))
    .flatMap((n) => probesOf(JSON.parse(readFileSync(join(dataDir, n), "utf8"))));
  if (probes.length > 0) {
    const existing = buildDirs.filter((d) => existsSync(d));
    if (existing.length === 0) {
      blocks.push("ビルド成果物のフォルダがありません(先に npm run build を実行してください)");
    }
    let scanned = 0;
    for (const dir of existing) {
      for (const path of walk(dir)) {
        if (statSync(path).size > MAX_BYTES) {
          skipped++;
          continue;
        }
        scanned++;
        for (const id of leakedIds(readFileSync(path, "utf8"), probes)) {
          blocks.push(`${path}: 非公開の問題 ${id} が含まれています`);
        }
      }
    }
    // 1 つも読めなかったときは、検査できないまま通さない
    if (existing.length > 0 && scanned === 0) blocks.push("ビルド成果物のフォルダに、探せるファイルがありません");
    process.stdout.write(
      `非公開の問題 ${probes.length} 件を、ビルド成果物 ${scanned} ファイルから探しました(読まずに飛ばしたもの ${skipped} 件)。\n`,
    );
  } else {
    process.stdout.write("非公開の問題がないので、検査するものがありません。\n");
  }
} catch {
  blocks.push("検査できませんでした(データまたはビルド成果物の読み込みに失敗)");
}

report(
  "非公開の問題の配信の検査に失敗しました。",
  blocks,
  [],
  "非公開の問題は、アプリの読み込みの対象にしないでください(docs/data-spec.md の「13. 非公開の問題」)。",
);
