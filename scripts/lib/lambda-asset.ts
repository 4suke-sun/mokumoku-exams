import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// standalone 出力は、リポジトリ直下を起点にたどるため、アプリは `packages/app` の下に入る
const APP_DIR_IN_STANDALONE = "packages/app";

const RUN_SH = `#!/bin/sh
cd ${APP_DIR_IN_STANDALONE}
exec node server.js
`;

type Options = {
  /** `packages/app` のディレクトリ(ビルド済みであること) */
  appDir: string;
  /** 成果物の出力先。中身は毎回作り直す */
  outDir: string;
};

/**
 * アプリのビルド成果物から、Lambda に載せるディレクトリ(lambda)と、S3 に置く静的ファイルのディレクトリ(static)を作る。
 *
 * - lambda: `.next/standalone` と、起動用の `run.sh`(Lambda Web Adapter が起動する)
 * - static: `/_next/static/*` と `public/*` の配信元(CloudFront が S3 から配る)
 */
export function buildLambdaAsset({ appDir, outDir }: Options): { lambdaDir: string; staticDir: string } {
  const standalone = join(appDir, ".next", "standalone");
  const nextStatic = join(appDir, ".next", "static");
  if (!existsSync(join(standalone, APP_DIR_IN_STANDALONE, "server.js")) || !existsSync(nextStatic)) {
    throw new Error("アプリのビルド成果物が見つかりません。先に `npm run build` を実行してください。");
  }

  rmSync(outDir, { recursive: true, force: true });
  const lambdaDir = join(outDir, "lambda");
  const staticDir = join(outDir, "static");

  cpSync(standalone, lambdaDir, { recursive: true });
  writeFileSync(join(lambdaDir, "run.sh"), RUN_SH);
  chmodSync(join(lambdaDir, "run.sh"), 0o755);

  mkdirSync(join(staticDir, "_next"), { recursive: true });
  cpSync(nextStatic, join(staticDir, "_next", "static"), { recursive: true });
  const publicDir = join(appDir, "public");
  if (existsSync(publicDir)) cpSync(publicDir, staticDir, { recursive: true });

  return { lambdaDir, staticDir };
}
