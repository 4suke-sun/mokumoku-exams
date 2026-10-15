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
 * アプリのビルド成果物から、Lambda に載せるディレクトリ(lambda)と、S3 に置く静的ファイルのディレクトリ(static、public)を作る。
 *
 * - lambda: `.next/standalone` と、起動用の `run.sh`(Lambda Web Adapter が起動する)。`public/*` は入れない
 * - static: `/_next/static/*` の配信元(CloudFront が S3 から配る。ファイル名にハッシュが入る)
 * - public: `public/*`(ブランドの画像、アイコン、Service Worker)の配信元(CloudFront が S3 から配る。ファイル名にハッシュがない)
 */
export function buildLambdaAsset({ appDir, outDir }: Options): {
  lambdaDir: string;
  staticDir: string;
  publicDir: string;
} {
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
  const publicDir = join(outDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const appPublic = join(appDir, "public");
  if (existsSync(appPublic)) cpSync(appPublic, publicDir, { recursive: true });
  // standalone の出力が public を含む版でも、Lambda には載せない(配信は S3 だけにする)
  rmSync(join(lambdaDir, APP_DIR_IN_STANDALONE, "public"), { recursive: true, force: true });

  return { lambdaDir, staticDir, publicDir };
}
