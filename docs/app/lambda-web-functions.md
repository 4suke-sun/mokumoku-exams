# Lambda Web Functions の調査

動的なページと API を、Lambda Web Adapter の構成から AWS Lambda Web Functions へ移せるかを調べた結果です。
判断は [ADR 0026](./adr/0026-keep-lambda-web-adapter-for-now.md) に書きます。事実は 2026-11-21 時点の公式の文書によります。
本番の環境では試していません(デプロイできるかは、検証用の環境で確かめる必要があります)。

## 今の構成

- `<接頭辞>-web` のスタックの Lambda(関数名は `<接頭辞>-app`。Node.js 22、x86_64、1024 MB)に、Lambda Web Adapter のレイヤーを付け、`run.sh` から Next.js の standalone の `server.js` を起動します([インフラの構築とデプロイ](./infra.md))。
- CloudFront のオリジンは Function URL(`authType: NONE`)で、CloudFront が付ける合言葉のヘッダー(`x-origin-verify`)を、アプリの `proxy.ts` が確かめます。
- 同時実行の上限は、設定したときだけ、予約済みの同時実行で決めます。アラームは、Lambda の `Errors`・`Throttles` と、API の失敗の記録のうち 5xx の件数(アプリのログから数える)です。

## 確かめた事実

### 形式と実行環境

- Web Function は、変更できないリビジョンと、リクエストを 1 つか 2 つのリビジョンへ振り分けるエンドポイントを持ちます。
  エンドポイントは、`<ドメイン ID>.<シャード ID>.lambda-web.<リージョン>.on.aws` の形の専用のドメインを持ち、HTTPS(443)だけで受けます。
  ([開発者ガイド](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[ランタイム](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.md))
- ランタイムは `nodejs24.x` と `nodejs26.x`(Python はプレビュー)。アーキテクチャは Arm64 だけで、選べません。
  1 つの実行環境は、2 vCPU・2 GB に固定です。([ランタイム](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-runtimes.md)、[設定](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration.md)、[クォータ](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.md#web-functions-quotas))
- コードは、版管理を有効にした S3 のバケットに置いた .zip だけです(コンテナーイメージは使えません)。展開後で 512 MB まで。
  オブジェクトの版を消すか、Lambda の読み取りの権限を外すと、そのリビジョンは失敗の状態になり、戻りません。
  ([S3 のコード](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-code-s3.md))
- サーバーは、Lambda が設定する `AWS_LAMBDA_HTTP_ENDPOINT`(`ホスト:ポート`)で、10 秒以内に待ち受けます。入口は、既定でパッケージ直下の `index.js`
  (`AWS_LAMBDA_NODEJS_ENTRYPOINT` で変えられます)。Next.js の standalone は、自分の変数で待ち受け先を決めるので、
  `AWS_LAMBDA_HTTP_ENDPOINT` を写す `index.js` を置く、と案内されています。
  ([Node.js](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-nodejs.md)、[設定](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration.md))
- リクエストのタイムアウトは 3〜900 秒(既定 30 秒)で、リビジョンごとに固定です。リクエスト行とヘッダーの合計は 128 KiB まで。HTTP/1.1 だけです。
  レスポンスのストリーミングは、追加の設定なしで使えます。本文の大きさの上限は、Web Functions の文書には書かれていません。
  ([HTTP](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-http.md)、[リビジョン](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.md))
- 対応するリージョンは、米国東部(バージニア北部、オハイオ)、米国西部(オレゴン)、アジアパシフィック(東京)、欧州(アイルランド)です。
  ([What's New](https://aws.amazon.com/about-aws/whats-new/2026/10/aws-lambda-web-functions/))

### CloudFront の背後に置く形

- エンドポイントの認証を `IamAuth` にし、CloudFront のオリジンアクセスコントロール(種類 `lambda`、署名の動作 `always-amz-auth`、署名 `sigv4`)で署名させます。
  関数のリソースベースのポリシーで、`cloudfront.amazonaws.com` に `lambda:InvokeWebFunctionEndpoint` を、`aws:SourceArn` を配信の ARN に限って許します。
  ([CloudFront の開発者ガイド](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)、[エンドポイントのアクセス制御](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.md))
- オリジンリクエストポリシーは、ビューアーの `Host` を送らないもの(`AllViewerExceptHostHeader`)にします。送ると 404 になります。今の構成と同じポリシーです。
  このオリジンの振る舞いには、Lambda@Edge のオリジン側のトリガーを付けられません(今は使っていません)。
  ([CloudFront の開発者ガイド](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html))
- `POST`・`PUT`・`PATCH` は、CloudFront が `UNSIGNED-PAYLOAD` で署名するので、ブラウザが本文のハッシュのヘッダーを付ける必要はありません
  (Function URL の OAC とは違います)。
  ([CloudFront の開発者ガイド](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html)、[Function URL の OAC](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html))
- `Authorization` は、CloudFront 経由ならアプリのものを素通しできます。今の認証は Cookie でトークンを持つので([認証の仕組み](./auth.md))、この点の影響はありません。
  ([CloudFront の開発者ガイド](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda-web.html))
- `IamAuth` のエンドポイントは、呼び出しを SigV4 の署名で認証します
  ([エンドポイントのアクセス制御](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.md))。
  署名のないリクエストを何の応答で断るかは、確かめていません。呼び出せるのは、リソースベースのポリシーで許した配信と、IAM で権限を与えた主体に限られるので、合言葉のヘッダーは要らなくなる見込みです。

### 同時実行と制限

- 1 つの実行環境が、`maxConcurrencyPerEnvironment`(1〜128、既定 64)件まで、同時に処理します。
  ([スケーリング](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.md))
- 予約済みの同時実行の代わりに、エンドポイントの `maxEnvironments`(2〜10,000、既定なし)と `rateLimit`(リージョンあたりの毎秒のリクエスト数。0、100〜1,000 は 100 刻み、2,000〜10,000 は 1,000 刻み)で上限を決めます。
  上限を超えたリクエストは 429 で断られ、待たされません。アカウントの Arm64 の vCPU のクォータ(既定 2,000、1 環境で 2)にも縛られます。
  ([スケーリング](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.md))
- 通信がないと、実行環境は 0 まで減ります。最小の数を保つ設定はありません。環境がいつ消えるかは決まっていません。
  ([実行環境のライフサイクル](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.md))
- メトリクスは、`AWS/Lambda/Web` の `HTTPResponseStatusClass5XX`・`HTTPResponseStatusClass4XX`(429 を含みます)と、
  `AWS/Lambda/Web/Usage` の `EndpointRequestThrottles`・`EndpointActiveEnvironmentThrottles` などです。Lambda の `Errors`・`Throttles` に当たる数は、これらで置き換えます。
  ログは `/aws/lambda/web/<関数名>` に集まります(リビジョンの設定で、ロググループを指定できます)。
  ([メトリクス](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring-metrics.md)、[監視](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-monitoring.md))

### ロールバック

- エンドポイントの `revisionWeights` を、前のリビジョンに 100 を与える形へ 1 回更新すれば戻せます(`autoDeploymentMode` を `Disabled` にします)。
  戻す先のリビジョンは、有効な状態のままで、コードの S3 のオブジェクトの版と実行ロールが残っている必要があります。
  重みが 0 でないリビジョンは消せません。リビジョンは、1 つの関数で 50 を目安に自動で片づけられます。
  ([デプロイ](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-deployment.md)、[リビジョン](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.md)、[クォータ](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.md#web-functions-quotas))
- 今の構成へ戻すには、移行の間、今の関数と Function URL を残しておき、CloudFront のオリジンを戻します。オリジンの切り替えは、CloudFront の配信の更新を待つ必要があります。

### IaC

- CloudFormation に `AWS::Lambda::WebFunction`(`FunctionName` と `Tags` だけ)、`AWS::Lambda::WebFunctionRevision`(コードの場所、ランタイム、環境変数、実行ロール、タイムアウトなど。変更はすべて置き換え)、
  `AWS::Lambda::WebFunctionEndpoint`(認証、`RevisionWeights`、`ScalingConfig`、`ThrottleConfig`。`DomainName` を返します)があります。
  ([WebFunction](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunction.html)、[WebFunctionRevision](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionrevision.html)、[WebFunctionEndpoint](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-lambda-webfunctionendpoint.html))
- CloudFront の OAC は、種類 `lambda`、署名の動作 `always-amz-auth` を CloudFormation で指定できます。
  ([OriginAccessControlConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-originaccesscontrol-originaccesscontrolconfig.html))
- このリポジトリで固定している `aws-cdk-lib`(2.277.0)には、L1 の `CfnWebFunction`・`CfnWebFunctionRevision`・`CfnWebFunctionEndpoint`・`CfnResourcePolicy` に加えて、
  `aws-lambda` に L2 の構成があります(型定義で確かめました)。
  - `WebFunction` は、本体・リビジョン・エンドポイント(`endpoint`)を 1 つの構成で作ります。ランタイム(`WebFunctionRuntime.NODEJS_24_X` など)、入口のファイル(`entryPoint`)、
    環境変数、実行ロール、ロググループ、タイムアウト、`maxConcurrencyPerEnvironment` を指定できます。`addEndpoint()` でエンドポイントを足せます。
  - `WebFunctionCode` は、コードの置き場を選びます。`fromAssetToManagedBucket()` は、版管理と SSE-S3 の暗号化と、`lambda.amazonaws.com` の読み取りの許可を備えたバケットを、スタックごとに作ります。
    自分のバケットに置くのは `fromAssetToProvidedBucket()`、すでにあるバケットのオブジェクト(バケットとキー)を使うのは `fromBucket()` です。
    版管理のないバケットは、この app で定義したバケットなら合成の時点で、取り込んだバケットなら配備の時点で失敗します。
  - エンドポイントの `grants.invoke()` は、サービスプリンシパルなどへの許可を、関数のリソースベースのポリシー(`AWS::Lambda::ResourcePolicy`)に書きます。
    CloudFront に呼ばせる許可は、これか `addToResourcePolicy()` で書けます。
  - エンドポイントの主な設定は、認証(`defaultEndpointAuth`)、名前(`endpointName`)、説明(`endpointDescription`)、場所(`endpointLocation`)、`maxEnvironments`、`rateLimit` です。
  - リビジョンへの振り分け(`WebFunctionTraffic`)は `single()` だけで、1 つのリビジョンにすべてを送ります。重みの指定はありません。
    `autoDeploymentMode` に当たる設定は、L2 にも L1(`CfnWebFunctionEndpoint`)の型定義にもありません。
    重みで段階的に移す、前のリビジョンへ戻す、には、L1 の `RevisionWeights` の上書きか、CLI が要る見込みです。
  - CloudFront の側は、種類 `lambda` の OAC の L2 が `FunctionUrlOriginAccessControl` で、その props の `signing` に `Signing.SIGV4_ALWAYS_AMZ_AUTH` を渡します
    (列挙の `SigningBehavior.ALWAYS_AMZ_AUTH` は、CloudFormation の値 `always-amz-auth` に当たる列挙です)。
    Web Function 専用のオリジンの構成(`aws-cloudfront-origins`)はなく、`HttpOrigin` にエンドポイントのドメインと OAC の ID(`originAccessControlId`)を渡す形になります。
- 固定している `cdkd`(0.322.1)は、`AWS::Lambda::WebFunctionRevision` と `AWS::Lambda::WebFunctionEndpoint` に専用の処理を持ちます。
  `AWS::Lambda::WebFunction` 本体には専用の処理がなく、Cloud Control API の経由で扱う形になります。
  Cloud Control API の対応の一覧には、`AWS::Lambda::WebFunction` の 3 つが載っていません
  ([対応するリソース](https://docs.aws.amazon.com/cloudcontrolapi/latest/userguide/supported-resources.html)。一覧の更新日は 2025-12)。
  本体を `cdkd` で作れるかは、検証用の環境で試すまで分かりません。

### 費用

- 課金は、リクエスト、アクティブな CPU の時間、実行環境が生きている間のメモリ(リクエストの合間の待ち時間を含みます)、データ転送です。
  ([開発者ガイド](https://docs.aws.amazon.com/lambda/latest/dg/web-functions.html)、[料金](https://aws.amazon.com/lambda/pricing/))
- 料金のページの例は、米国東部(バージニア北部)の Arm だけで、リクエストが 100 万件あたり 0.30 USD、vCPU 秒あたり 0.0000276944 USD、GB 秒あたり 0.0000036667 USD です。
  東京の単価と、Web Functions の無料利用枠は、確かめられませんでした。
- Event Functions(従来の関数)には、月 100 万件のリクエストと 40 万 GB 秒の無料利用枠があります
  ([料金](https://aws.amazon.com/lambda/pricing/)。料金のページは一部しか読めず、この数は抽出の要約によります。原文では照合していません)。
- 試算(米国東部の単価): 1 つの実行環境は 2 GB に固定なので、生きているだけで 1 時間あたり約 0.026 USD のメモリの料金がかかります
  (2 GB × 3,600 秒 × 0.0000036667 USD)。1 日 8 時間、1 つの環境が生きていると、月に約 6 USD です。
  今の利用の規模では、従来の関数は無料利用枠に収まる見込みが高く、移すと費用は増える側です。
  通信が増え、1 つの環境で多くの同時リクエストをさばくようになると、差は縮みます。

## 移すときに変わること

| 項目 | 今 | Web Functions |
| --- | --- | --- |
| 起動 | Lambda Web Adapter のレイヤー + `run.sh` | `index.js` で `AWS_LAMBDA_HTTP_ENDPOINT` を写して `server.js` を読み込む |
| ランタイム | Node.js 22、x86_64、1024 MB | Node.js 24 以降、Arm64、2 vCPU・2 GB 固定 |
| コードの置き場 | `cdkd` のアセット | 版管理を有効にした S3 のバケット(古い版を消さない) |
| 入口の保護 | Function URL(`NONE`)+ `x-origin-verify` | `IamAuth` + OAC(合言葉のヘッダーと `proxy.ts` の確認は外す) |
| 同時実行の上限 | 予約済みの同時実行 | `maxEnvironments` と `rateLimit` |
| アラーム | Lambda の `Errors`・`Throttles` と、API の失敗の記録のうち 5xx の件数(アプリのログから数える) | `HTTPResponseStatusClass5XX` と、`AWS/Lambda/Web/Usage` の制限の数。API の失敗の記録のうち 5xx の件数は、ロググループを指定して続けられる見込み |
| 切り戻し | 前のコードで再デプロイ | エンドポイントの重みを前のリビジョンへ |

成果物は、`npm run build:lambda` の `dist/lambda` に `index.js` を足し、`run.sh` を外す形で作れます。
`dist/static`・`dist/public` の分け方と、CloudFront の振る舞い(S3 と動的なオリジンの分け方)は、そのまま使えます。
アプリの依存には、ネイティブのモジュールがないので、Arm64 への切り替えで作り直すものはない見込みです。

## まだ確かめていないこと

- `cdkd` で `AWS::Lambda::WebFunction` 本体を作れるか(検証用の環境で、3 つのリソースと OAC を作って試す)。
- 東京の単価と、Web Functions の無料利用枠の有無。
- 1 つの実行環境で同時に複数のリクエストを処理したときに、アプリのモジュールの変数(キャッシュなど)が、利用者をまたいで混ざらないか。
- 実行環境が待ちのままどれだけ残るか(メモリの料金に直結します)。
