# インフラの構築とデプロイ

`packages/infra` は、AWS CDK(TypeScript)でインフラを定義します。デプロイは `cdkd` で行います(v1.0.0 まで。素の `cdk` と混在させません)。
環境固有の値は、リポジトリに書かず、`.env` から渡します。

## 構成

| スタック | 内容 |
| --- | --- |
| `<接頭辞>-auth` | Cognito UserPool。セルフサインアップ禁止、管理者の招待制、管理者グループ(`admins`)。招待メールと再設定の確認コードの文面、パスワードの規則を持ちます。Identity Pool は作りません。画面と API は [認証の仕組み](./auth.md) |
| `<接頭辞>-data` | DynamoDB の単一テーブル(学習の履歴)。使った分だけの課金で、暗号化は既定(AWS 所有のキー)。スタックを消してもテーブルは残り、削除保護と時点復旧(過去 35 日)が有効です。設計は [データの設計](./data.md) |
| `<接頭辞>-web` | Lambda(Next.js + Lambda Web Adapter)、Function URL、CloudFront、静的ファイル用の S3 |

`<接頭辞>-web` の Lambda には、`COGNITO_USER_POOL_ID`(ID トークンの検証)と `HISTORY_TABLE_NAME`(履歴のテーブル)が渡されます。
履歴のテーブルに許す操作は、`GetItem`・`PutItem`・`UpdateItem`・`Query`・`DeleteItem` だけです(テーブル 1 つに限り、スキャンやテーブルの管理はできません)。
デプロイの順は、auth → data → web です(`cdkd deploy --all` が依存から決めます)。

配信の流れは、[アーキテクチャの計画](./architecture-plan.md) のとおりです。

- `/_next/static/*` は S3 から配ります(CloudFront から S3 へは、オリジンアクセスコントロールで読みます。バケットは公開しません)。
- それ以外は Lambda の Function URL へ渡します。Function URL は認証なし(`authType: NONE`)で、CloudFront が付ける合言葉のヘッダー(`x-origin-verify`)を、
  アプリ(`packages/app/src/proxy.ts`)が確かめます。合言葉のないリクエスト(Function URL への直接のアクセス)は、403 で断ります。
- 独自ドメインは、まだ設定しません。CloudFront の標準のドメインで配信します。

### キャッシュとセキュリティヘッダー

- 動的な応答(画面と API)は、キャッシュしません。静的ファイル(`/_next/static/*`)は、ファイル名にハッシュが入るので、長くキャッシュします。
- すべての応答に、次のヘッダーを付けます(アプリ側が同じヘッダーを付けても、CloudFront の設定を優先します)。
  `Strict-Transport-Security`(1 年、サブドメインを含む)、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`。
  `Content-Security-Policy` は、まだ付けません。

### ログと監視

- アプリ(Lambda)のログは、ロググループを明示して作り、30 日で消えるようにしています。
- Lambda のエラーと実行制限(スロットリング)に、アラームがあります(5 分間に 1 回以上で鳴ります)。通知先は SNS トピックです。
- `.env` の `ALARM_EMAIL` を渡すと、そのアドレスをトピックに購読させます。デプロイの後に届く確認のメールで、購読を承認します。
  渡さないときは、トピックだけが作られ、アラームの状態は CloudWatch の画面で確かめます。

## この版で扱わないこと

次の項目は、別の段階で扱います。

- CloudFront の監視(CloudFront のメトリクスは別リージョンにあるため、別の段階で扱います)
- 管理者向けの多要素認証の検討
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
   | `ALARM_EMAIL` | (省略可)アラームの通知先のメールアドレス |

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
