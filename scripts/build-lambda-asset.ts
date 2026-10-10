#!/usr/bin/env node
/**
 * アプリのビルド成果物から、Lambda に載せるアセットを `dist/` に作る(先に `npm run build` が必要)。
 *
 *   node scripts/build-lambda-asset.ts
 */
import { resolve } from "node:path";
import { buildLambdaAsset } from "./lib/lambda-asset.ts";

const root = resolve(import.meta.dirname, "..");
const { lambdaDir, staticDir } = buildLambdaAsset({
  appDir: resolve(root, "packages/app"),
  outDir: resolve(root, "dist"),
});
process.stdout.write(`Lambda 用: ${lambdaDir}\n静的ファイル用: ${staticDir}\n`);
