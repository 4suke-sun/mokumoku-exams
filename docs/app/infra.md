# インフラの構築とデプロイ

`packages/infra` は、AWS CDK(TypeScript)でインフラを定義します。デプロイは `cdkd` で行います(v1.0.0 まで。素の `cdk` と混在させません)。
環境固有の値は、リポジトリに書かず、`.env` から渡します。

## 構成

| スタック | 内容 |
| --- | --- |
| `<接頭辞>-auth` | Cognito UserPool。セルフサインアップを許し(登録の確認はメールの確認コード)、管理者グループ(`admins`)を持ちます。確認コードのメール(登録の確認とパスワードの再設定で共通)の文面と、パスワードの規則を持ちます。Identity Pool は作りません。画面と API は [認証の仕組み](./auth.md) |
| `<接頭辞>-data` | DynamoDB の単一テーブル(学習の履歴)。使った分だけの課金で、暗号化は既定(AWS 所有のキー)。スタックを消してもテーブルは残り、削除保護と時点復旧(過去 35 日)が有効です。設計は [データの設計](./data.md) |
| `<接頭辞>-web` | Lambda(Next.js + Lambda Web Adapter)、Function URL、CloudFront、静的ファイル用の S3 |
| `<接頭辞>-push` | (通知の設定をそろえたときだけ)毎日の通知を送る Lambda と、そのスケジュール(EventBridge のルール) |
| `<接頭辞>-budget` | (予算の設定をそろえたときだけ)月の費用の予算(AWS Budgets)。「費用の予算と共通のタグ」 |

`<接頭辞>-web` の Lambda には、`COGNITO_USER_POOL_ID`(ID トークンの検証)と `HISTORY_TABLE_NAME`(履歴のテーブル)が渡されます。
設定したときだけ、`SITE_URL`(sitemap と robots、共有のカードの画像の絶対 URL)と、`VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY_PARAMETER`・`VAPID_SUBJECT`(通知の購読とテスト通知)も渡されます。
設定したときだけ、`FEEDBACK_GITHUB_APP_ID`・`FEEDBACK_GITHUB_INSTALLATION_ID`・`FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER`(送信フォームの起票)も渡されます。
VAPID の秘密鍵と、送信フォームの GitHub App の秘密鍵は、値ではなく、置き場所(SSM パラメーター)の名前だけを渡します(「VAPID の秘密鍵」「GitHub App の秘密鍵」)。
履歴のテーブルに許す操作は、`GetItem`・`PutItem`・`UpdateItem`・`Query`・`DeleteItem` だけです(テーブル 1 つに限り、スキャンやテーブルの管理はできません)。管理者の操作の記録も、このテーブルに置きます。
Cognito に許す操作は、管理者の画面が使う `ListUsers`・`AdminDisableUser` と、登録し直し(確認がまだのアカウントの状態を読み、24 時間たったものだけを消す)が使う `AdminGetUser`・`AdminDeleteUser` だけです(`<接頭辞>-auth` スタックの UserPool 1 つに限ります)。
それ以外の、登録・確認・確認コードの送り直し・退会(本人による削除)は、認証情報のいらない Cognito の API で行うため、Lambda の権限は要りません(登録したメールアドレスがすでにあるときの登録し直しだけは、上の `AdminGetUser`・`AdminDeleteUser` を使います)。
仮パスワードの有効日数(7 日)は、管理者が作ったユーザーの仮パスワードの扱いを変えないよう、明示して残しています。
デプロイの順は、auth → data → web で、push は data と web のあとです(web のアラームの通知先を使うため。`cdkd deploy --all` が依存から決めます)。budget は、ほかのスタックに依存しません。

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

### 費用の予算と共通のタグ

- CDK のアプリ全体(`packages/infra/bin/app.ts`)で、すべてのスタックとリソースに、共通のタグ `Service=mokumoku-exams` を付けます。
  値は固定で、`STACK_PREFIX` を変えても同じです(値は `packages/infra/lib/tags.ts` の `SERVICE_TAG`)。
- タグで費用を絞るには、請求の設定で、このタグをコスト配分タグとして有効にします。AWS アカウントごとに一度だけ、管理アカウント(請求を見られるユーザー)で行います。
  1. デプロイして、タグの付いたリソースを作ります(タグのキーが選択肢に出るまで、最大で 24 時間ほどかかります)。
  2. 請求とコスト管理のコンソールの「コスト配分タグ」を開き、ユーザー定義のタグの一覧から `Service` を選んで「有効化」します。
  3. 有効にしたあとの費用から、Cost Explorer と AWS Budgets でタグを使って絞れます(有効にする前の費用は、タグでは絞れません)。
- `.env` に `BUDGET_MONTHLY_USD` と `BUDGET_EMAIL` をそろえて渡すと、`<接頭辞>-budget` に月の費用の予算を作ります。
  共通のタグ(`user:Service$mokumoku-exams`)で絞った費用について、次のときに `BUDGET_EMAIL` へメールで知らせます(購読の承認は要りません)。

  | 種類 | 条件 |
  | --- | --- |
  | 実績(ACTUAL) | 予算の 80% を超えたとき、100% を超えたとき |
  | 予測(FORECASTED) | 月末までの予測が、予算の 100% を超えたとき |

- 片方だけを渡すと、合成の前に止まります。どちらも渡さないときは、予算を作りません。
- 予算はアカウントの単位で、タグは環境の接頭辞を含みません。同じアカウントに接頭辞の違う環境を置くときは、予算の設定はどれか 1 つの環境の `.env` だけに書きます(ほかの環境も同じタグで数えられるため)。
- タグを付けられない費用(税など)は、予算に数えられません。アカウント全体の費用は、請求の画面で確かめます。

### 同時実行の上限

- `.env` の `APP_RESERVED_CONCURRENCY` を渡すと、アプリの Lambda に、その数の同時実行を予約します(それより多くは同時に動きません)。
  上限に達したときの実行の制限は、実行制限のアラーム(`Throttles`)で知らせます。
- 予約は、アカウントの同時実行の上限から差し引かれ、予約しない分を 100 以上残す必要があります(上限が既定の 1,000 なら、予約できるのは 900 まで)。上限が 100 以下のアカウント(新しいアカウントでは小さいことがある)では予約できず、
  デプロイが失敗します。先に、Service Quotas で Lambda の同時実行の上限の引き上げを申請します(例: 上限を既定の 1,000 にすれば、予約 10 を渡せます)。
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
   渡さないときは、DNS の CNAME などで、ドメイン名を CloudFront のドメイン(出力の `DistributionDomainName`。伏せていない出力を人が自分の端末で見る)へ向けます。

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
   | `FUNCTION_URL` | (省略可)アプリの Lambda の Function URL(`https://example.com` の形。末尾のスラッシュなし)。デプロイ直後の自動のスモーク(`scripts/smoke.ts`。[デプロイ後の画面確認](../post-deploy-smoke.md))だけが読み、合言葉のない直接のアクセスが断られることを確かめます。インフラのコードは読みません。渡さないときは、その項目を省略し、人が確かめます |
   | `WEB_ADAPTER_LAYER_ARN` | Lambda Web Adapter のレイヤーの ARN(バージョン付き)。デプロイ先のリージョンのものを、Lambda Web Adapter の公式の案内から調べます |
   | `ORIGIN_VERIFY_VALUE` | CloudFront とアプリの間の合言葉。32 文字以上のランダムな文字列を、自分で作ります |
   | `STACK_PREFIX` | (省略可)リソース名の先頭に付ける文字列。既定は `mokumoku-exams` |
   | `ALARM_EMAIL` | (省略可)アラームの通知先のメールアドレス |
   | `APP_RESERVED_CONCURRENCY` | (省略可)アプリの Lambda の同時実行の上限(1〜1000 の整数)。渡したときだけ付けます(「同時実行の上限」) |
   | `SITE_URL` | (省略可)公開の URL の起点(`https://example.com` の形。末尾のスラッシュなし)。sitemap と robots、共有のカード(X・Qiita などのリンクの表示)の画像の絶対 URL に使います。渡さないときは、sitemap は空で、カードに画像は出ません |
   | `VAPID_PUBLIC_KEY` | (省略可)プッシュ通知の VAPID の公開鍵。下の 2 つとそろえて渡します |
   | `VAPID_PRIVATE_KEY_PARAMETER` | (省略可)VAPID の秘密鍵を置いた SSM パラメーター(SecureString)の名前。`/` で始まる階層の名前にします。値は `.env` に書きません |
   | `VAPID_SUBJECT` | (省略可)送信者の連絡先(`mailto:` か `https://` で始まる)。プッシュサービスが、問題があったときの連絡に使います |
   | `FEEDBACK_GITHUB_APP_ID` | (省略可)送信フォームの起票に使う GitHub App の ID(数字)。下の 2 つとそろえて渡します。渡さないときは起票せず、送信の API は `503` を返します(「GitHub App の秘密鍵」) |
   | `FEEDBACK_GITHUB_INSTALLATION_ID` | (省略可)その App の、このリポジトリへのインストールの ID(数字) |
   | `FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER` | (省略可)App の秘密鍵(PEM)を置いた SSM パラメーター(SecureString)の名前。`/` で始まる階層の名前にします。値は `.env` に書きません |
   | `DOMAIN_NAME`、`CERTIFICATE_ARN`、`HOSTED_ZONE_ID` | (省略可)独自ドメイン。「独自ドメイン」を参照 |
   | `BUDGET_MONTHLY_USD` | (省略可)月の費用の予算の金額(USD。小数は 2 桁まで)。`BUDGET_EMAIL` とそろえて渡します(「費用の予算と共通のタグ」) |
   | `BUDGET_EMAIL` | (省略可)予算を超えそうなときに知らせるメールアドレス |

   VAPID の鍵は、`npx web-push generate-vapid-keys` で作ります。公開鍵は `.env` に書き、秘密鍵は SSM パラメーターに置きます(「VAPID の秘密鍵」)。秘密鍵は、ほかに書き写しません。
   鍵を作り直すと、それまでの購読には送れなくなります(利用者が、アカウントの画面で購読し直します)。
   `SITE_URL` には、初回のデプロイのあとに出力される CloudFront のドメイン(`DistributionDomainName`。`mask` を通した出力では伏せられるので、伏せていない出力を人が自分の端末で見る)を `https://` に続けて書き、もう一度デプロイします。独自ドメインを使うときは、`DOMAIN_NAME` のドメインを書きます。

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
- この秘密鍵について、Lambda(アプリと送信)に許すのは、このパラメーター 1 つの `ssm:GetParameter` だけです(ARN にワイルドカードを使いません)。
  アプリの Lambda は、送信フォームを設定したときは、App の秘密鍵のパラメーターも読めます(「GitHub App の秘密鍵」。読めるパラメーターは、合わせて 2 つです)。
- Lambda は、最初に送るときに 1 度だけ読み(`WithDecryption`)、そのプロセスの間は覚えておきます。読めないときは、値も原因も出しません。
  テスト通知の API は `503` を返し、毎日の送信は「鍵を読めない」の種類だけをログに出して、失敗として終わります。
- 鍵を変えるときは、`aws ssm put-parameter --overwrite` で値を上書きします。動いている Lambda は前の値を覚えているため、新しい値は、Lambda が次に起動したときから使われます。

### GitHub App の秘密鍵

送信フォーム([送信フォームの仕様](./specs/feedback.md))の内容は、このリポジトリ専用の GitHub App として、このリポジトリの Issue に起票します。
起票した Issue の作成者は `<App の名前>[bot]` になります。

App の作成とインストールは、人が GitHub の画面で行います。

1. App を作ります(個人の設定の Developer settings → GitHub Apps → New GitHub App)。
   - Webhook は使いません(Active のチェックを外します)。
   - 権限は、Repository permissions の Issues を Read and write にするだけです(Metadata の Read-only は、自動で付きます)。ほかの権限は付けません。
   - インストールできる範囲は、自分のアカウントだけにします(Only on this account)。
2. App を、このリポジトリだけにインストールします(Only select repositories)。インストールの ID は、インストールの設定の画面の URL の末尾の数字です。
3. 秘密鍵(PEM)を作り、SSM Parameter Store の SecureString に置きます。CDK が扱うのは、パラメーターの名前(`FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER`)だけです。
   置いたあと、手元の PEM のファイルは消します。

```sh
# 名前とファイルのパスはプレースホルダー。値はファイルから読み、シェルの履歴に残さない
aws ssm put-parameter --type SecureString --name /<パラメーターの名前> --value file://<PEM のファイル>
```

4. App の ID とインストールの ID を `.env` に書きます(秘密ではありませんが、環境固有の値なので、リポジトリには書きません)。

- 暗号化の鍵と、Lambda に `kms:Decrypt` を付けない理由は、「VAPID の秘密鍵」と同じです。この秘密鍵について、アプリの Lambda に許すのは、このパラメーター 1 つの `ssm:GetParameter` だけです(ARN にワイルドカードを使いません)。
  3 つの変数を渡さないときは、読む権限を付けません。
- アプリの Lambda は、最初に送るときに 1 度だけ秘密鍵を読み(`WithDecryption`)、そのプロセスの間は覚えておきます。
  秘密鍵から RS256 の JWT(`iat` は 60 秒前、`exp` は 9 分後、`iss` は App の ID)を Node の標準の `crypto` で作り、
  インストールのアクセストークンを発行します(`POST /app/installations/{installation_id}/access_tokens`)。
  発行のときに、リポジトリを起票先の 1 つ(`repositories`)に、権限を Issues の書き込み(`permissions` の `issues: write`)に絞ります。
  トークンは 1 時間で切れるので、切れる 5 分前までは、プロセスの間で使い回します。起票は `POST /repos/{owner}/{repo}/issues` です。
- 秘密鍵の値、JWT、インストールのトークンの値と、読めない・呼べない原因は、ログとエラー応答に出しません。失敗は、例外の名前(`GithubUnavailableError`)だけが記録に残ります。
- GitHub の API の制約(GitHub の公式の文書「Rate limits for the REST API」による):
  - 「Primary rate limit for GitHub App installations」: インストールのトークンの回数の上限は、1 時間あたり 5,000 回以上です。
  - 「About secondary rate limits」: 内容を作る操作(Issue の起票を含む)は、1 分に 80 回、1 時間に 500 回までです(Web の画面の操作も同じ枠)。
  - 1 件の送信で、起票の 1 回(トークンを発行し直すときは、発行の 1 回を足す)を使います。1 人 1 日 10 件の上限で、全利用者の合計が枠を超えたときは、送信の API が `503` を返し、数えた 1 を戻します。
- 料金: GitHub App の作成と利用について、公式の文書に料金の記載はありません。SSM の標準のパラメーターに、追加の料金はかかりません。
- 秘密鍵は、App の設定の画面(Credentials の Key pairs)で作ります。ダウンロードした PEM が、秘密鍵の唯一の写しです(GitHub は公開鍵の部分だけを持ちます)。
- 秘密鍵を入れ替えるときは、App の設定の画面で新しい秘密鍵を作り、`aws ssm put-parameter --overwrite` で値を上書きしてから、古い秘密鍵を App の設定の画面で消します
  (GitHub の公式の文書「Managing private keys for GitHub Apps」)。動いている Lambda は前の値を覚えているため、新しい値は、Lambda が次に起動したときから使われます。
  古い秘密鍵を消すのは、上書きから 1 日おいてからにします(動いている Lambda の実行環境が入れ替わるのを待つため。先に消すと、古い値を覚えた実行環境で起票が失敗し、送信の API が `503` を返します)。
- 秘密鍵に有効期限はなく、消すまで使えます。漏れたときは、新しい秘密鍵を作って上の手順で入れ替え、漏れた秘密鍵をすぐに消します(App の最後の 1 つの秘密鍵は消せないため、先に新しいものを作ります)。

## ビルドとデプロイ

デプロイの前に、[デプロイ前のチェックリスト](../pre-deploy-checklist.md)を通します。

```sh
set -o pipefail        # パイプの途中のコマンドの失敗を、終了コードに出す(下の mask を通す行のため)
npm run build          # アプリをビルドする
npm run build:lambda   # Lambda に載せるアセットを dist/ に作る(dist/lambda、dist/static、dist/public、dist/push)
npm run synth 2>&1 | npm run -s mask   # スタックを合成する(出力の値を伏せる)
npm run diff -w @mokumoku-exams/infra -- --all 2>&1 | npm run -s mask   # すべてのスタックの変わる内容を、値を伏せて確かめる
npm run deploy -w @mokumoku-exams/infra -- --all   # すべてのスタックをデプロイする(人が自分の端末で実行する)
```

デプロイの直後に、[デプロイ後の画面確認](../post-deploy-smoke.md)を通します。通るまで、公開へ進みません。

- `npm run synth` / `deploy` / `diff` / `destroy`(`-w @mokumoku-exams/infra`)は、`.env` を読み込んでから `cdkd` を実行します。
- 合成と差分の出力は、`npm run -s mask` に通して値を伏せます。デプロイ(`deploy`・`destroy`)は、確認の問いが出うるうえ、パイプの相手が先に終わると途中で止まりうるので、`mask` を通さず、人が自分の端末で実行します。デプロイの出力を共有・記録するときは、保存した出力を `npm run -s mask < <ファイル>` に通します。
  伏せる形と伏せない形、終了コード(`set -o pipefail`)、確認の問いの扱いは、[学びの記録 0004](./lessons/0004-mask-diff-output.md) にあります。出力の配信のドメインも伏せるので、ドメインが要るときは、伏せていない出力を人が自分の端末でだけ見ます。
- 合成は AWS の認証情報が必要です(`cdkd` がアカウントを調べるため)。CI では合成せず、スタックの単体テスト(スナップショットを含む)で確かめます。
- `dist/` と `cdk.out/` は gitignore 済みです。

## 注意

- AWS の値(アカウント ID、ARN、ドメイン、ID)は、コードにもドキュメントにも書きません。例を書くときは、`123456789012` や `example.com` を使います。
- 合言葉の値は、Lambda の環境変数と CloudFront のオリジンのヘッダーに入ります。値を変えるときは、`.env` を直して再デプロイします。
- VAPID の秘密鍵と GitHub App の秘密鍵は、Lambda の環境変数に入りません。SSM パラメーターの名前だけが入ります(「VAPID の秘密鍵」「GitHub App の秘密鍵」)。
- `dist/push` は、`packages/app/src/lib/push/daily.ts` から相対で読み込むファイルを JavaScript にしたものと、使うパッケージ(`web-push` と AWS SDK の DynamoDB・SSM)です。
  このディレクトリのファイルは、`@/` の別名を使いません(使うと `npm run build:lambda` が失敗します)。
- スタックの変更後は、`packages/infra` のスナップショットを更新します(`npx vitest run -u -w @mokumoku-exams/infra`)。差分が意図したものか、確かめてから更新します。
