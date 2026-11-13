# デプロイ前のチェックリスト

環境へ `cdkd` でデプロイする前に、1 項目ずつ確かめます。対象は、**コードと設定を静的に確かめる項目**です。
デプロイしたあとの実機の挙動(実際にサインインできる、ボタンが動く、API が応答する)は、[デプロイ後の画面確認](./post-deploy-smoke.md)で確かめます。
結果は、場所と種類だけで記録し、値は書きません。デプロイの手順そのものは[インフラの構築とデプロイ](./app/infra.md)にあります。

公開前の最終確認([公開前のチェックリスト](./pre-release-checklist.md))は、リポジトリを公開するときの機密・権利の確認で、範囲が違います。この文書は、デプロイのたびに通します。

## 1. 環境変数

| 項目 | 確認の方法 |
| --- | --- |
| 必須の値が、`.env` にそろっていて、形が合っている | `.env` を `.env.example` と見比べる。足りない、または形が違うと、`packages/infra/lib/config.ts` の検査が、変数の名前だけを示して止まる(`npm test -w @mokumoku-exams/infra` が通る) |
| 使う機能の任意の値が、そろっている | 通知を使う環境は、`VAPID_PUBLIC_KEY`・`VAPID_PRIVATE_KEY_PARAMETER`・`VAPID_SUBJECT` の 3 つをそろえ、秘密鍵の SSM パラメーターをデプロイの前に作っておく。独自ドメインは、`DOMAIN_NAME` と `CERTIFICATE_ARN` をそろえる。費用の予算は、`BUDGET_MONTHLY_USD` と `BUDGET_EMAIL` をそろえ、同じアカウントの 1 つの環境だけに書く(予算はアカウント単位で数えるため。[費用の予算と共通のタグ](./app/infra.md))。`APP_RESERVED_CONCURRENCY` を渡すときは、アカウントの Lambda の同時実行の上限に、予約しない分を 100 以上残せることを、先に Service Quotas で確かめる(足りないとデプロイが失敗する。[同時実行の上限](./app/infra.md))。一部だけ渡すと、合成の前に、変数の名前を示して止まる(まったく渡さなければ、その機能は作られない) |
| アプリが読む値が、実行時に読まれる(Lambda の環境変数)ものと、ビルドに埋め込まれるものとで、取り違えられていない | 今の構成では、アプリが読む値(`ORIGIN_VERIFY_VALUE`、`COGNITO_USER_POOL_ID`、`HISTORY_TABLE_NAME`、`VAPID_PUBLIC_KEY` など)は、Lambda の環境変数で、実行時に読む。`NEXT_PUBLIC_` で始まる、ビルドに埋め込まれる値は使っていない。ビルドに埋め込まれる値を足したときは、値を変えるたびに `npm run build` と `npm run build:lambda` をやり直す |
| アプリが読む環境変数が、アプリの Lambda(`<接頭辞>-web` スタックの関数 `<接頭辞>-app`)へ渡される | `npm run check:env` が通る(アプリが読む名前と、`packages/infra/lib/web-stack.ts` の `environment` を突き合わせる。Lambda が自動で与える `AWS_REGION` と、開発用の `AUTH_FAKE` は除く)。渡す側に足した変数が、アプリで使われているかは、この検査では確かめない。通知の送信の Lambda(`<接頭辞>-push` スタックの関数 `<接頭辞>-push-sender`)に渡す変数と、動的な参照(`env[変数]` など)も対象外なので、送信の Lambda を変えたときは、`packages/infra/lib/push-stack.ts` を見て確かめる |
| 環境変数の値が、リポジトリのファイルにない | `node scripts/check-commit-secrets.ts` が通る。`.env` が追跡されていない(`git ls-files` に出ない) |

## 2. 同じ配信元の構成

画面と API は、CloudFront の同じ配信元から出します。ブラウザが別の配信元を呼ぶ構成ではないので、認証は Cookie のトークンと、サーバー側の検証で成り立ちます([認証の仕組み](./app/auth.md))。

| 項目 | 確認の方法 |
| --- | --- |
| 画面と API が、同じ配信元の同じパスの下で応答する構成のままである | CloudFront の設定(`/_next/static/*` と `public/` のファイル(`/brand/*`・`/icons/*`・`/sw.js`)は S3、それ以外は Lambda の Function URL)が、`packages/infra` のスナップショットテスト(`npm test -w @mokumoku-exams/infra`)の差分で意図どおりである |
| 合言葉(`x-origin-verify`)の値が、3 か所でそろっている | `.env` の `ORIGIN_VERIFY_VALUE`、Lambda の環境変数、CloudFront のオリジンのヘッダーが、同じ値から作られる(スタックの単体テストが確かめる)。アプリ(`packages/app/src/proxy.ts`)が、合言葉のない要求を 403 で断る |

実際に応答するかは、デプロイ後の確認で扱います。

## 3. 認証

| 項目 | 確認の方法 |
| --- | --- |
| 認証のコードと設定が、意図どおりである(ID トークンの検証、保護する画面と API の範囲、UserPool の設定、確認コードの文面) | `npm test` が通る。特に `packages/app/src/authorization.test.ts`(画面・API・ファイルの経路の一覧)と、`packages/infra` のテスト。新しい画面・API・`public/` のファイルを足したときは、一覧に足してあり、公開するか保護するかを決めてある(`public/` の `/brand/*`・`/icons/*`・`/sw.js` は S3 から配るので、保護できない。公開してよいものだけを置き、ほかの場所に足すときは CloudFront の振り分けにも足す) |
| Cookie と別サイトからの送信の扱いが、意図どおりである | Cookie が `HttpOnly`・`SameSite=Lax`・本番は `Secure`。状態を変える `POST` が、`Sec-Fetch-Site` で別サイトからのものを断る。詳細は[認証の仕組み](./app/auth.md)の「トークンの扱い」 |

実際にサインインできるかは、デプロイ後の確認で扱います。

## 4. 画面の部品

| 項目 | 確認の方法 |
| --- | --- |
| ボタン・リンク・フォームに、`onClick` や送信の処理がある。動作のない部品が残っていない | 差分でボタンなどの追加を探し、処理がつながっていることを確かめる。`npm run test:e2e` が通る |

押したときの実際の動作は、デプロイ後の確認で扱います。

## 5. `cdkd` の引数

| 項目 | 確認の方法 |
| --- | --- |
| `cdkd` の引数の順序が合っている | サブコマンドの後ろにオプション、スタック名や `--all` を置く。`npm run deploy -w @mokumoku-exams/infra -- --all` の形を正とする。素の `cdk` と混在させない |

## 6. 差分

| 項目 | 確認の方法 |
| --- | --- |
| 変わる内容が、意図したものだけである | `npm run diff -w @mokumoku-exams/infra -- --all` の出力を、`set -o pipefail` のうえで `2>&1 \| npm run -s mask` に通して読む。環境変数の値(合言葉など)が出るので、伏せた出力だけを扱う。伏せない形と、終了コードの扱いは [lessons/0004](./app/lessons/0004-mask-diff-output.md) |

## 7. ビルドとテスト

| 項目 | 確認の方法 |
| --- | --- |
| デプロイする作業ツリーの先頭が、最新のタグと同じコミットである | `git describe --tags --exact-match HEAD` が成功し、最新のタグ(`git tag --list 'v*' --sort=-v:refname` の先頭)を指す。未コミットの変更がない(`git status --short` が空)。一致しないときは、タグのない変更を含むので、デプロイしない(版を切ってからデプロイする) |
| ルートの検査が通る | `npm run lint`、`npm run typecheck`、`npm test`、`npm run build` が通る |
| Lambda に載せる成果物を作れる | `npm run build:lambda` が成功する(CI の `app` ジョブも、`npm run build` のあとに実行する。先に `npm run build` が要る) |
| 非公開の問題が配信に含まれない | `npm run check:unpublished-bundle` が通る(`npm run build` のあとに実行する。非公開の問題(`data/unpublished.<コード>.json`)の設問文と ID が、`.next` にないこと(設問文が 12 文字未満の問題は、設問文を探さず、ID だけを探す(偶然の一致を避けるため))。CI の `app` ジョブも実行する) |

## 8. 手順の最後に

上の節の項目がすべて確かめられたら、[デプロイ](./app/infra.md)に進みます。デプロイの直後に、[デプロイ後の画面確認](./post-deploy-smoke.md)を通します。
