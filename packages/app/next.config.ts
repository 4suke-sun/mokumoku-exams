import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// 問題データ(リポジトリ直下の data/)をモノレポの外から読み込むため、ルートをリポジトリ直下にする
const repoRoot = resolve(import.meta.dirname, "../..");

/** 以前の試験コードの URL を、新しいコードの URL へ永続的に転送する(資格マスタの `previousCodes`) */
function legacyExamRedirects() {
  const { exams } = JSON.parse(readFileSync(resolve(repoRoot, "data/exams.json"), "utf8")) as {
    exams: { examCode: string; previousCodes?: string[] }[];
  };
  return exams.flatMap(({ examCode, previousCodes = [] }) =>
    previousCodes.flatMap((old) =>
      // 資格の配下の画面(`/exams/<旧>/…`)と、管理者のプレビュー(`/admin/preview/<旧>`)。問い合わせは、そのまま引き継ぐ
      ["/exams", "/admin/preview"].flatMap((base) => [
        { source: `${base}/${old}`, destination: `${base}/${examCode}`, permanent: true },
        { source: `${base}/${old}/:path*`, destination: `${base}/${examCode}/:path*`, permanent: true },
      ]),
    ),
  );
}

const config: NextConfig = {
  // Lambda に載せるため、実行に必要なファイルだけをまとめた出力(.next/standalone)を作る
  output: "standalone",
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  redirects: async () => legacyExamRedirects(),
};

export default config;
