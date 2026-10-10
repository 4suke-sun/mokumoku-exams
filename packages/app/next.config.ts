import { resolve } from "node:path";
import type { NextConfig } from "next";

// 問題データ(リポジトリ直下の data/)をモノレポの外から読み込むため、ルートをリポジトリ直下にする
const repoRoot = resolve(import.meta.dirname, "../..");

const config: NextConfig = {
  // Lambda に載せるため、実行に必要なファイルだけをまとめた出力(.next/standalone)を作る
  output: "standalone",
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

export default config;
