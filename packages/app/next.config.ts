import { resolve } from "node:path";
import type { NextConfig } from "next";

// 問題データ(リポジトリ直下の data/)をモノレポの外から読み込むため、ルートをリポジトリ直下にする
const repoRoot = resolve(import.meta.dirname, "../..");

const config: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
};

export default config;
