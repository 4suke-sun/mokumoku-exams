# インフラの構築とデプロイ

`packages/infra` は、AWS CDK(TypeScript)でインフラを定義します。デプロイは `cdkd` で行います(v1.0.0 まで。素の `cdk` と混在させません)。
環境固有の値は、リポジトリに書かず、`.env` から渡します。

## 構成

| スタック | 内容 |
| --- | --- |
| `<接頭辞>-auth` | Cognito UserPool。セルフサインアップ禁止、管理者の招待制、管理者グループ(`admins`)。招待メールと再設定の確認コードの文面、パスワードの規則を持ちます。Identity Pool は作りません。画面と API は [認証の仕組み](./auth.md) |
| `<接頭辞>-web` | Lambda(Next.js + Lambda Web Adapter)、Function URL、CloudFront、静的ファイル用の S3 |

配信の流れは、[アーキテクチャの計画](./architecture-plan.md) のとおりです。

- `/_next/static/*` は S3 から配ります(CloudFront から S3 へは、オリジンアクセスコントロールで読みます。バケットは公開しません)。
- それ以外は Lambda の Function URL へ渡します。Function URL は認証なし(`authType: NONE`)で、CloudFront が付ける合言葉のヘッダー(`x-origin-verify`)を、
  アプリ(`packages/app/src/proxy.ts`)が確かめます。合言葉のないリクエスト(Function URL への直接のアクセス)は、403 で断ります。
- 独自ドメインは、まだ設定しません。CloudFront の標準のドメインで配信します。キャッシュの設定は、別の段階で整えます。

## この版で扱わないこと

次の項目は、別の段階で扱います。

- 配信のキャッシュ設定とセキュリティヘッダー、ログと監視(アラーム)
- 管理者向けの多要素認証の検討
- データの保護設定(バックアップ・削除保護)
- 独自ドメイン

## 準備

1. 依存を入れます: `npm ci`
2. `.env.example` を `.env` にコピーし、プレースホルダーを実際の値に置き換えます。`.env` は gitignore 済みで、コミットしません。

   | 変数 | 内容 |
   | --- | --- |
   | `AWS_PROFILE` | 使う AWS のプロファイル名 |
   | `AWS_REGION` | デプロイ先のリージョン |
   | `WEB_ADAPTER_LAYER_ARN` | Lambda Web Adapter のレイヤーの ARN(バージョン付き)。デプロイ先のリージョンのものを、Lambda Web Adapter の公式の案内から調べます |
   | `ORIGIN_VERIFY_VALUE` | CloudFront とアプリの間の合言葉。32 文字以上のランダムな文字列を、自分で作ります |
   | `STACK_PREFIX` | (省略可)リソース名の先頭に付ける文字列。既定は `mokumoku-exams` |

   値の形は `packages/infra/lib/config.ts` が検査します。足りない、または形が違うと、変数の名前だけを示して止まります(値は表示しません)。

3. 初回だけ、AWS アカウントごとに `cdkd bootstrap` を実行します。

## ビルドとデプロイ

```sh
npm run build          # アプリをビルドする
npm run build:lambda   # Lambda に載せるアセットを dist/ に作る(dist/lambda と dist/static)
npm run synth          # スタックを合成する
npm run deploy -w @mokumoku-exams/infra
```

- `npm run synth` / `deploy` / `diff` / `destroy`(`-w @mokumoku-exams/infra`)は、`.env` を読み込んでから `cdkd` を実行します。
- 合成は AWS の認証情報が必要です(`cdkd` がアカウントを調べるため)。CI では合成せず、スタックの単体テスト(スナップショットを含む)で確かめます。
- `dist/` と `cdk.out/` は gitignore 済みです。

## 注意

- AWS の値(アカウント ID、ARN、ドメイン、ID)は、コードにもドキュメントにも書きません。例を書くときは、`123456789012` や `example.com` を使います。
- 合言葉の値は、Lambda の環境変数と CloudFront のオリジンのヘッダーに入ります。値を変えるときは、`.env` を直して再デプロイします。
- スタックの変更後は、`packages/infra` のスナップショットを更新します(`npx vitest run -u -w @mokumoku-exams/infra`)。差分が意図したものか、確かめてから更新します。
