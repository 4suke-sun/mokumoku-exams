# インフラの構築とデプロイ

`packages/infra` は、AWS CDK(TypeScript)でインフラを定義します。デプロイは `cdkd` で行います(v1.0.0 まで。素の `cdk` と混在させません)。
環境固有の値は、リポジトリに書かず、`.env` から渡します。

## 構成

| スタック | 内容 |
| --- | --- |
| `<接頭辞>-auth` | Cognito UserPool。セルフサインアップ禁止、管理者の招待制、管理者グループ(`admins`)。招待メールと再設定の確認コードの文面、パスワードの規則を持ちます。Identity Pool は作りません。画面と API は [認証の仕組み](./auth.md) |
| `<接頭辞>-data` | DynamoDB の単一テーブル(学習の履歴)。使った分だけの課金で、暗号化は既定(AWS 所有のキー)。スタックを消してもテーブルは残り、削除保護と時点復旧(過去 35 日)が有効です。設計は [データの設計](./data.md) |
| `<接頭辞>-web` | Lambda(Next.js + Lambda Web Adapter)、Function URL、CloudFront、静的ファイル用の S3 |
| `<接頭辞>-push` | (通知の設定をそろえたときだけ)毎日の通知を送る Lambda と、そのスケジュール(EventBridge のルール) |

`<接頭辞>-web` の Lambda には、`COGNITO_USER_POOL_ID`(ID トークンの検証)と `HISTORY_TABLE_NAME`(履歴のテーブル)が渡されます。
設定したときだけ、`SITE_URL`(sitemap の絶対 URL)と、`VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY_PARAMETER`・`VAPID_SUBJECT`(通知の購読とテスト通知)も渡されます。
VAPID の秘密鍵は、値ではなく、置き場所(SSM パラメーター)の名前だけを渡します(「VAPID の秘密鍵」)。
履歴のテーブルに許す操作は、`GetItem`・`PutItem`・`UpdateItem`・`Query`・`DeleteItem` だけです(テーブル 1 つに限り、スキャンやテーブルの管理はできません)。管理者の操作の記録も、このテーブルに置きます。
Cognito に許す操作は、管理者の画面が使う `ListUsers`・`AdminCreateUser`・`AdminDisableUser` だけです(`<接頭辞>-auth` の UserPool 1 つに限ります)。
デプロイの順は、auth → data → web で、push は data と web のあとです(web のアラームの通知先を使うため。`cdkd deploy --all` が依存から決めます)。

### 通知の送信(`<接頭辞>-push`)

- 毎日 11:00(UTC。日本時間の 20:00)に、EventBridge のルールが送信の Lambda を動かします。失敗しても送り直しません(同じ日に 2 回届かないように)。
  ルールのターゲットの再試行と、Lambda の非同期呼び出しの再試行(`AWS::Lambda::EventInvokeConfig` の `MaximumRetryAttempts`)は、どちらも 0 です。
- 無効になった購読は、全員への送信のあとに 1 件ずつ消します。消せなかった購読は、数えて残りを続けます(関数は失敗にしません。次の日の送信で、また無効と分かれば消します)。
- 送信の Lambda は、購読しているすべての端末に、学習のリマインドを送ります。購読の扱いは [データの設計](./data.md) の「通知の購読」です。
- 送信の Lambda に許すのは、履歴のテーブルの `Scan` と `DeleteItem` だけです(利用者をまたいで購読を集め、無効になった購読を消すため)。Function URL はなく、外からは呼べません。
- 送信の Lambda とアプリの Lambda に許すのは、秘密鍵のパラメーター 1 つの `ssm:GetParameter` だけです(「VAPID の秘密鍵」)。
- ログは 30 日で消えます。記録するのは、送れた数・送れなかった数・消した購読の数・消せなかった購読の数だけです(購読の情報は出しません)。秘密鍵を読めないときは、その種類(`vapid-key-unavailable`)だけを記録して終わります。
- 通知の設定(`VAPID_*`)をそろえないときは、このスタックを作りません。アカウントの画面では「この環境では、通知を設定できません」と表示します。

配信の流れは、[アーキテクチャの計画](./architecture-plan.md) のとおりです。

- `/_next/static/*` は S3 から配ります(CloudFront から S3 へは、オリジンアクセスコントロールで読みます。バケットは公開しません)。
- `packages/app/public/` のファイル(ブランドの画像、アイコン、通知を受け取る Service Worker)も、S3 から配ります(`/brand/*`・`/icons/*`・`/sw.js`)。
  Lambda には載せません。入口の proxy を通らないので、この 3 つの経路のファイルは、ログインなしで取れます(公開してよいものだけを置きます)。
  `public/` のほかの場所にファイルを足すときは、CloudFront の振り分け(`packages/infra/lib/web-stack.ts` の `PUBLIC_ASSET_PATHS`)にも足します。
- 問題データ(正解と解説を含む)は、静的ファイルとしては配りません。出題・結果・ブックマークの画面は、開いたあとに、表示に要る問題だけを、
  ログインが必要な API(`POST /api/questions`)で取ります。
- それ以外は Lambda の Function URL へ渡します。Function URL は認証なし(`authType: NONE`)で、CloudFront が付ける合言葉のヘッダー(`x-origin-verify`)を、
  アプリ(`packages/app/src/proxy.ts`)が確かめます。合言葉のないリクエスト(Function URL への直接のアクセス)は、403 で断ります。
- 独自ドメインは任意です。`.env` に値がなければ、CloudFront の標準のドメインで配信します(「独自ドメイン」)。

### キャッシュとセキュリティヘッダー

- 動的な応答(画面と API)は、キャッシュしません。静的ファイル(`/_next/static/*`)は、ファイル名にハッシュが入るので、長くキャッシュします
  (ブラウザには `max-age=31536000, immutable`)。
- `public/` のブランドの画像とアイコンは、ファイル名にハッシュがないので、1 日だけキャッシュします(`max-age=86400`)。
  Service Worker(`/sw.js`)は、更新がすぐに行き渡るよう、CloudFront でもブラウザでもキャッシュしません(`no-cache`)。
- S3 への配置は、古いファイルを消しません(`prune: false`)。デプロイの途中や、古い画面を開いたままの人が、消えたファイルを取りに行かないためです。
  ファイルは小さく、名前にハッシュが入るので、消さずに残しても困りません。
- すべての応答に、次のヘッダーを付けます(アプリ側が同じヘッダーを付けても、CloudFront の設定を優先します)。
  `Strict-Transport-Security`(1 年、サブドメインを含む)、`X-Content-Type-Options: nosniff`、
  `Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`。
- CSP は、まず報告だけのヘッダー(`Content-Security-Policy-Report-Only`)で、すべての応答に付けます(値は `packages/infra/lib/web-stack.ts` の `CONTENT_SECURITY_POLICY`)。
  読み込み元は自分のオリジンだけにし、Next が埋め込むインラインのスクリプトと、インラインの `style` 属性のため、当面は `'unsafe-inline'` を許します。
  違反は、ブラウザのコンソールで確かめます(報告の受け取り先は作りません)。
  強制(`Content-Security-Policy`)に切り替えるのは、次がそろったときです。
  - 主要な画面(ログイン、資格の一覧、出題、結果、学習の状況、アカウント、管理)を本番で開き、コンソールに違反が出ないこと。
  - 通知の購読とテスト通知(Service Worker)が、報告だけの状態で問題なく動くこと。
  - 切り替えるときは、ヘッダーの名前だけを変え、値は同じにする(値を変えるときは、また報告だけで確かめる)。

### ログと監視

- アプリ(Lambda)のログは、ロググループを明示して作り、30 日で消えるようにしています。
- アプリが例外で 503 を返すとき、1 行の JSON を標準エラーに出します。対象は、履歴・通知・管理者の API が保存先などの例外で返す 503 と、
  入口の `proxy.ts` が認証の検証に失敗して返す 503(画面の経路も含みます)です。
  例外ではない 503(通知の鍵が設定されていないときのテスト通知)と、ログインなどの認証の API が返す 503 は、記録しません。
  中身は、印(`"event": "api-failure"`)、経路(パスだけ。問い合わせの文字列は含めません)、返した状態、例外の名前だけです。
  例外のメッセージ・スタック・本文・利用者の識別子・入力の値は出しません。
- 次のアラームがあります。どれも 5 分間に 1 回以上で鳴り、通知先は `<接頭辞>-web` の SNS トピックです。

  | アラーム | 数えるもの |
  | --- | --- |
  | アプリの Lambda のエラー | Lambda の `Errors`(関数そのものの失敗) |
  | アプリの Lambda の実行制限 | Lambda の `Throttles` |
  | アプリの 5xx | アプリのログのうち、失敗の記録で状態が 500 以上のもの(上の記録の対象。メトリクスフィルターで数えます。名前空間は `<接頭辞>`、メトリクスは `ApiServerErrors`) |
  | 送信の Lambda のエラー | 毎日の通知を送る Lambda の `Errors`。1 日 1 回の実行なので、1 回の失敗が、その日の送信の失敗です(`<接頭辞>-push` を作ったときだけ) |

  アプリが 5xx を返しても、Lambda の呼び出しとしては成功するので、`Errors` には数えられません。アプリの 5xx のアラームは、そのためのものです。
- `.env` の `ALARM_EMAIL` を渡すと、そのアドレスをトピックに購読させます。デプロイの後に届く確認のメールで、購読を承認します。
  渡さないときは、トピックだけが作られ、アラームの状態は CloudWatch の画面で確かめます。

### 同時実行の上限

- `.env` の `APP_RESERVED_CONCURRENCY` を渡すと、アプリの Lambda に、その数の同時実行を予約します(それより多くは同時に動きません)。
  上限に達したときの実行の制限は、実行制限のアラーム(`Throttles`)で知らせます。
- 予約は、アカウントの同時実行の上限から差し引かれ、予約しない分を 10 以上残す必要があります。上限が小さいアカウント(新しいアカウントでは 10 のことがある)では予約できず、
  デプロイが失敗します。先に、Service Quotas で Lambda の同時実行の上限の引き上げを申請します(例: 上限 100 なら、予約 10 を渡せます)。
- 渡さないときは、予約しません(アカウントの上限までは同時に動きます)。

### 独自ドメイン

`.env` に `DOMAIN_NAME` と `CERTIFICATE_ARN` を渡すと、CloudFront にそのドメイン名と証明書を付けます。値がなければ、何も変わりません。

1. 使うドメイン名(例: `app.example.com`)の証明書を、ACM で **us-east-1** に発行します(CloudFront は us-east-1 の証明書だけを使えます)。
   スタックのデプロイ先のリージョンが違っても、証明書は us-east-1 に置きます。
2. `.env` に、次を書きます。

   | 変数 | 内容 |
   | --- | --- |
   | `DOMAIN_NAME` | 配信に使うドメイン名(例: `app.example.com`) |
   | `CERTIFICATE_ARN` | 1 の証明書の ARN(`arn:aws:acm:us-east-1:<アカウント ID>:certificate/<証明書の ID>`) |
   | `HOSTED_ZONE_ID` | (省略可)ドメイン名を置く Route 53 のホストゾーンの ID |

3. デプロイします。`HOSTED_ZONE_ID` を渡したときは、ドメイン名から CloudFront への A と AAAA のレコード(エイリアス)も作ります。
   渡さないときは、DNS の CNAME などで、ドメイン名を CloudFront のドメイン(出力の `DistributionDomainName`)へ向けます。

- `DOMAIN_NAME` と `CERTIFICATE_ARN` は、そろえて渡します。片方だけ、またはドメイン名なしでホストゾーンだけを渡すと、合成の前に止まります。
- 独自ドメインを付けても、CloudFront の標準のドメインでも、そのままアクセスできます。

## この版で扱わないこと

次の項目は、別の段階で扱います。

- CloudFront の監視(CloudFront のメトリクスは別リージョンにあるため、別の段階で扱います)
- 管理者向けの多要素認証の検討

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
   | `APP_RESERVED_CONCURRENCY` | (省略可)アプリの Lambda の同時実行の上限(1〜1000 の整数)。渡したときだけ付けます(「同時実行の上限」) |
   | `SITE_URL` | (省略可)公開の URL の起点(`https://example.com` の形。末尾のスラッシュなし)。sitemap と robots の絶対 URL に使います。渡さないときは、sitemap は空です |
   | `VAPID_PUBLIC_KEY` | (省略可)プッシュ通知の VAPID の公開鍵。下の 2 つとそろえて渡します |
   | `VAPID_PRIVATE_KEY_PARAMETER` | (省略可)VAPID の秘密鍵を置いた SSM パラメーター(SecureString)の名前。`/` で始まる階層の名前にします。値は `.env` に書きません |
   | `VAPID_SUBJECT` | (省略可)送信者の連絡先(`mailto:` か `https://` で始まる)。プッシュサービスが、問題があったときの連絡に使います |
   | `DOMAIN_NAME`、`CERTIFICATE_ARN`、`HOSTED_ZONE_ID` | (省略可)独自ドメイン。「独自ドメイン」を参照 |

   VAPID の鍵は、`npx web-push generate-vapid-keys` で作ります。公開鍵は `.env` に書き、秘密鍵は SSM パラメーターに置きます(「VAPID の秘密鍵」)。秘密鍵は、ほかに書き写しません。
   鍵を作り直すと、それまでの購読には送れなくなります(利用者が、アカウントの画面で購読し直します)。
   `SITE_URL` には、初回のデプロイのあとに出力される CloudFront のドメイン(`DistributionDomainName`)を `https://` に続けて書き、もう一度デプロイします。独自ドメインを使うときは、`DOMAIN_NAME` のドメインを書きます。

   値の形は `packages/infra/lib/config.ts` が検査します。足りない、または形が違うと、変数の名前だけを示して止まります(値は表示しません)。

3. 初回だけ、AWS アカウントごとに `cdkd bootstrap` を実行します。

### VAPID の秘密鍵

秘密鍵は、Lambda の環境変数にもテンプレートにも入れず、SSM Parameter Store の SecureString に置きます。
CloudFormation は SecureString を作れないため、パラメーターは、通知を使う環境ごとに 1 度だけ、デプロイの前に自分で作ります。
CDK が扱うのは、パラメーターの名前(`VAPID_PRIVATE_KEY_PARAMETER`)だけです。

```sh
# 名前と値はプレースホルダー。値は、シェルの履歴に残らない方法で渡す
aws ssm put-parameter --type SecureString --name /<パラメーターの名前> --value <VAPID の秘密鍵>
```

- 暗号化の鍵は、既定の `aws/ssm`(AWS 管理の鍵)を使います(`--key-id` を付けません)。この鍵のポリシーは、アカウント内のロールに、
  Systems Manager を経た復号を許すため、Lambda には `kms:Decrypt` を付けていません。自分で管理する鍵で暗号化したときは、その鍵の復号を別に許す必要があります。
- Lambda(アプリと送信)に許すのは、このパラメーター 1 つの `ssm:GetParameter` だけです(ARN にワイルドカードを使いません)。
- Lambda は、最初に送るときに 1 度だけ読み(`WithDecryption`)、そのプロセスの間は覚えておきます。読めないときは、値も原因も出しません。
  テスト通知の API は `503` を返し、毎日の送信は「鍵を読めない」の種類だけをログに出して、失敗として終わります。
- 鍵を変えるときは、`aws ssm put-parameter --overwrite` で値を上書きします。動いている Lambda は前の値を覚えているため、新しい値は、Lambda が次に起動したときから使われます。

## ビルドとデプロイ

デプロイの前に、[デプロイ前のチェックリスト](../pre-deploy-checklist.md)を通します。

```sh
npm run build          # アプリをビルドする
npm run build:lambda   # Lambda に載せるアセットを dist/ に作る(dist/lambda、dist/static、dist/public、dist/push)
npm run synth          # スタックを合成する
npm run diff -w @mokumoku-exams/infra -- --all     # すべてのスタックの変わる内容を確かめる
npm run deploy -w @mokumoku-exams/infra -- --all   # すべてのスタックをデプロイする
```

デプロイの直後に、[デプロイ後の画面確認](../post-deploy-smoke.md)を通します。通るまで、公開へ進みません。

- `npm run synth` / `deploy` / `diff` / `destroy`(`-w @mokumoku-exams/infra`)は、`.env` を読み込んでから `cdkd` を実行します。
- 合成は AWS の認証情報が必要です(`cdkd` がアカウントを調べるため)。CI では合成せず、スタックの単体テスト(スナップショットを含む)で確かめます。
- `dist/` と `cdk.out/` は gitignore 済みです。

## 注意

- AWS の値(アカウント ID、ARN、ドメイン、ID)は、コードにもドキュメントにも書きません。例を書くときは、`123456789012` や `example.com` を使います。
- 合言葉の値は、Lambda の環境変数と CloudFront のオリジンのヘッダーに入ります。値を変えるときは、`.env` を直して再デプロイします。
- VAPID の秘密鍵は、Lambda の環境変数に入りません。SSM パラメーターの名前だけが入ります(「VAPID の秘密鍵」)。
- `dist/push` は、`packages/app/src/lib/push/daily.ts` から相対で読み込むファイルを JavaScript にしたものと、使うパッケージ(`web-push` と AWS SDK の DynamoDB・SSM)です。
  このディレクトリのファイルは、`@/` の別名を使いません(使うと `npm run build:lambda` が失敗します)。
- スタックの変更後は、`packages/infra` のスナップショットを更新します(`npx vitest run -u -w @mokumoku-exams/infra`)。差分が意図したものか、確かめてから更新します。
