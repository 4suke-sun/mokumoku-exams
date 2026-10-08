#!/usr/bin/env node
/**
 * リポジトリ直下の .env を読み込んでから、渡されたコマンドを実行する。
 * 環境固有の値(プロファイル名・ドメイン・ホストゾーン ID など)を、コマンドラインやコードに
 * 書かずに .env に置くための入口。すでに環境変数にある値は上書きしない。
 *
 *   node scripts/with-env.ts <コマンド> [引数...]
 */
import { spawnSync } from "node:child_process";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
}
catch (error) {
  // .env が無いのは正常(CI など)。それ以外(構文エラー等)は気づけるよう表に出す。
  if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  process.stderr.write("使い方: node scripts/with-env.ts <コマンド> [引数...]\n");
  process.exit(2);
}

const result = spawnSync(command, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
