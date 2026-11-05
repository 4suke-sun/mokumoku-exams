# もくもく問題集

クラウド資格(AWS など)の学習用に、問題を解き、間違いを復習できる Web アプリです。開発中(ベータ)です。

## できること

- 資格ごとに、通常出題、復習、本番モード(制限時間つき)、セクションで解く、自由記述の問題を解く
- 単元ごとに読んでから解く学習モード、試験の直前に見返す要約カード、ブックマークの見直し
- 合格予測、分野別の正答数、実績の表示
- メールアドレスとパスワードで自分で登録して使うログイン(Cognito)。学習の記録、表示の設定、ブックマークをアカウントに保存する。退会もできる
- 管理者の画面(利用者の一覧・無効化、全問のプレビュー)

資格と問題のデータは、リポジトリ直下の `data/` の JSON です。仕様は [docs/data-spec.md](./docs/data-spec.md)、資格の足し方は
[docs/adding-an-exam.md](./docs/adding-an-exam.md)、作問パイプラインで問題を作る手順は [docs/question-production.md](./docs/question-production.md) にあります。

## 構成

| 場所 | 内容 |
| --- | --- |
| `packages/app` | アプリ本体(Next.js / TypeScript / App Router / Tailwind) |
| `packages/infra` | インフラの定義(AWS CDK / TypeScript)。Cognito、DynamoDB、Lambda、CloudFront、S3 |
| `data/` | 資格、問題、カリキュラム、体系ノート、コードドリル、要約カード、リリースノートの JSON |
| `scripts/` | データの検査、リリースノートの検査、機密検査などのスクリプト |
| `docs/` | 設計、データの仕様、運用の手順 |

設計の全体は [docs/app/architecture-plan.md](./docs/app/architecture-plan.md) にあります。

## 開発の始め方

必要なもの: Node.js 22.18 以上(TypeScript をそのまま実行できる版)

```sh
npm install                # 依存を入れ、検査フック(.githooks)を有効にします
AUTH_FAKE=1 npm run dev    # 開発サーバーを起動します(http://localhost:3000)
```

`AUTH_FAKE=1` は、AWS に接続しない、メモリ上の代替の認証で起動する指定です(開発の間だけ有効で、本番のビルドでは無効です)。
ログインに使う架空のユーザーは、[docs/app/auth.md](./docs/app/auth.md) の「手元での確認」にあります。
この指定では、学習の記録の保存先(DynamoDB)には接続しません。

```sh
npm test                   # 単体テスト(Vitest)
npm run typecheck          # 型検査(tsc)
npm run lint               # lint と整形の確認(Biome)
npm run build              # ビルド
npm run test:e2e           # 主要な画面の通し確認(Playwright。初回は npx playwright install chromium が必要です)
```

コマンドの一覧、ブランチ・コミット・PR・リリースの決まりは [CONTRIBUTING.md](./CONTRIBUTING.md) にあります。

## 自分の AWS に置く

環境固有の値(プロファイル名・ドメインなど)は、`.env.example` をコピーした `.env`(gitignore 済み)に書きます。
リポジトリには、実値を書きません。デプロイの手順は [docs/app/infra.md](./docs/app/infra.md) を見てください。

## 公開前の確認

公開前に確かめる項目は、[docs/pre-release-checklist.md](./docs/pre-release-checklist.md) にあります。

## 商標について

AWS をはじめとする、資格や製品の名前は、それぞれの提供元の商標です。このリポジトリは、どの提供元とも関係がなく、
提供元が承認したものでもありません。名前は、学習の対象を示すためだけに使っています。

## ライセンス

[MIT License](./LICENSE)
