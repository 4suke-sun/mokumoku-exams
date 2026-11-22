# 0028. 言語とツールの統一(TypeScript、Biome、Vitest)と、手元と CI の Node 24

- 状態: 採用
- 日付: 2026-11-22
- 置き換える ADR: 0001

## 背景

画面、API、インフラ、検査スクリプトのすべてで、同じ言語とツールを使えると、型の共有と保守がしやすくなります。
TypeScript をビルドせずに Node の型除去で実行するため、手元と CI の Node の版は、依存が求める版をすべて満たす必要があります。
作問パイプラインの PDF の取り出し(unpdf)は Node 24 以上を求めます。画面部品のテストの jsdom は、Node 24 なら 24.15 以上を求めます。
アプリの Lambda(と通知の送信の Lambda)には、この 2 つは載りません。

## 決定

- 言語は **TypeScript** に統一します(`scripts/` も含みます)。実行は Node の型除去で直接行い(ビルドは不要)、型検査は `tsc --noEmit` で行います。
- lint と整形は **Biome** 1 本にします。
- テストは **Vitest** にします。
- 手元と CI の Node は **24** にします。下限は、ルートの `package.json` の `engines`(`^24.15.0 || >=26.0.0`)で持ちます。
- アプリの Lambda の実行環境は、Node 22(`nodejs22.x`)のままにします。`@types/node` は、Lambda の Node に合わせて 22 系にします。

## 理由

- フロントエンドとバックエンドで型を共有できます。
- Biome は、リンターと整形ツールが 1 つで、設定が 1 ファイルで済みます。TypeScript の最新版にも、そのまま対応できます。
- Vitest は TypeScript をそのまま扱え、Next.js のアプリ側でも同じ設定で使えます。
- `engines` の下限は、unpdf と jsdom の `engines` の両方を満たす範囲です。
- Lambda のランタイムを上げると、デプロイの差分と実行環境の確認が別に要ります。Node 24 を求める依存は Lambda に載らないので、手元と CI だけを上げます。
  型を Lambda に合わせると、Lambda で動くコードが Node 24 にしかない API を使ったときに、型検査で気づけます。

## 採用しなかった選択肢

- ESLint + Prettier: 設定とパッケージが多くなります。ESLint の TypeScript 用プラグインは、対応する TypeScript の版が限られます。
- Jest: TypeScript の追加設定が必要で、Vitest の方が設定が少なく済みます。
- JavaScript(.mjs)のスクリプト: 型検査の対象外になり、アプリ側との型の共有ができません。
- 手元と CI を Node 22 のままにする: unpdf の `engines` を満たしません。
- Lambda のランタイムも Node 24 に上げる: 依存の都合では必要がなく、デプロイの確認の範囲が広がります。上げるときは別の作業にします。

## 影響

- 手元と CI で、Node 24(24.15 以上)が必要です。手順は `CONTRIBUTING.md` の「準備」にあります。
- 手元と Lambda で Node のメジャーが違います。Lambda で動くコードの API の範囲は、`@types/node`(22 系)の型検査で守ります。
- Biome は、型情報を使う検査の範囲が、ESLint の TypeScript 用プラグインより狭くなります。型の誤りは `tsc` が検出します。
