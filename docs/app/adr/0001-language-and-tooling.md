# 0001. 言語とツールの統一(TypeScript、Biome、Vitest)

- 状態: 置き換え済み(置き換えた ADR: 0028)
- 日付: 2026-10-08

## 背景

画面、API、インフラ、検査スクリプトのすべてで、同じ言語とツールを使えると、型の共有と保守がしやすくなります。

## 決定

- 言語は **TypeScript** に統一します(`scripts/` も含みます)。実行は Node の型除去で直接行い(ビルドは不要)、型検査は `tsc --noEmit` で行います。
- lint と整形は **Biome** 1 本にします。
- テストは **Vitest** にします。

## 理由

- フロントエンドとバックエンドで型を共有できます。
- Biome は、リンターと整形ツールが 1 つで、設定が 1 ファイルで済みます。TypeScript の最新版にも、そのまま対応できます。
- Vitest は TypeScript をそのまま扱え、Next.js のアプリ側でも同じ設定で使えます。

## 採用しなかった選択肢

- ESLint + Prettier: 設定とパッケージが多くなります。ESLint の TypeScript 用プラグインは、対応する TypeScript の版が限られます。
- Jest: TypeScript の追加設定が必要で、Vitest の方が設定が少なく済みます。
- JavaScript(.mjs)のスクリプト: 型検査の対象外になり、アプリ側との型の共有ができません。

## 影響

- Node.js 22.18 以上が必要です(TypeScript をそのまま実行できる版)。
- Biome は、型情報を使う検査の範囲が、ESLint の TypeScript 用プラグインより狭くなります。型の誤りは `tsc` が検出します。
