#!/usr/bin/env node
/**
 * アプリのビルド成果物から、Lambda に載せるアセットを `dist/` に作る(先に `npm run build` が必要)。
 * あわせて、毎日の通知を送る Lambda のアセット(`dist/push`)を作る。
 *
 *   node scripts/build-lambda-asset.ts
 */
import { resolve } from "node:path";
import { buildLambdaAsset } from "./lib/lambda-asset.ts";
import { buildPushAsset } from "./lib/push-asset.ts";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "dist");
const { lambdaDir, staticDir, publicDir } = buildLambdaAsset({ appDir: resolve(root, "packages/app"), outDir });
const pushDir = buildPushAsset({ root, outDir });
process.stdout.write(
  `Lambda 用: ${lambdaDir}\n静的ファイル用: ${staticDir}\npublic 用: ${publicDir}\n通知の送信用: ${pushDir}\n`,
);
