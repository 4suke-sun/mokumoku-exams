# もくもく問題集

クラウド資格(AWS など)の学習用に、問題を解き、間違いを復習できる Web アプリ。公開リポジトリなので、
環境固有の値は一切コミットしない。

## 進め方

- 小さな段階(v0.1.0 → v0.2.0 → …)に分けて進める。各段階の終わりで、人が確認してから次へ進む。
- 段階ごとに `data/release-notes.json` へその版のエントリを追記し、同じ版のタグ(`vX.Y.Z`)を切る(1:1)。
- 版番号はセマンティックバージョニングに従う。メジャーは 0 のまま(ベータ)。マイナーは、互換性を保つ機能の追加で、
  規模にかかわらず機能を含む版は必ずマイナーを上げる。パッチは、互換性を保つバグ修正のみ。破壊的な変更はメジャーを上げる(v1.0.0 以降)。
- 迷う点は、実装の前に質問する。勝手に仕様を足さない。
- 新しい画面やモードは、実装の前に短い仕様を書き、承認を得てから作る([画面の仕様のひな形](docs/ui-spec-template.md))。
- PR は原則、版単位(1 つの版を 1 つの PR にまとめ、その版の Issue を `Closes` で閉じる)。
  E2E などが整ったあとの不具合・hotfix は、Issue 単位でよい。
- v1.0.0 はまだ先(検証・作問のパイプラインの確立、他の資格の取り込みがそろってから)。それまでは、メジャーを 0 のまま、マイナーを上げていく。
- 履歴の書き換え(公開済みの履歴への `reset`、`--force` / `--force-with-lease` の push、`filter-repo` など)は
  原則しない。必要なら、理由を説明して人の承認を待つ。

## 技術構成

- 言語は TypeScript で統一する(`scripts/` も含む)。テストは Vitest。lint と整形は Biome(`npm run lint` / `npm run format`)。
  TypeScript は Node の型除去で直接実行する(ビルド不要。`node scripts/xxx.ts`)。型検査は `tsc --noEmit`。
- npm workspaces のモノレポ: `packages/app`(Next.js / TypeScript / App Router / Tailwind)、
  `packages/infra`(素の AWS CDK / TypeScript。Amplify は使わない)、
  `packages/data-schema`(データの契約: スキーマと検査、出典に許すドメインの一覧)、
  `packages/pipeline`(作問パイプライン)。
- `packages/pipeline` は、app など他のワークスペースの内部を import しない。共有するのは `data-schema` だけ
  (`npm run check:boundary` が CI で守る)。進め方は [docs/pipeline-workflow.md](docs/pipeline-workflow.md)、
  出典の扱いは [docs/source-policy.md](docs/source-policy.md)。
- 認証は Cognito UserPool のみ。セルフサインアップ禁止、管理者の招待制、管理者グループ。
- データは DynamoDB 単一テーブル(`PK=USER#{sub}` / `SK` で種別分岐)。サーバー側で ID トークンを検証し、
  `sub` で自分の分だけ操作する。
- ホスティングは Lambda Web Adapter + CloudFront + S3。Function URL は `authType: NONE` + シークレットヘッダー方式。
- 問題データは `data/questions.<code>.json` など。スキーマは `docs/data-spec.md`。
- v1.0.0 までのデプロイは `cdkd`。素の `cdk` と混在させない。

## 開発ルール

- コミット・PR タイトルは Conventional Commits。ブランチ名は `<prefix>/#<Issue番号>-…`。
- 作者は GitHub の noreply アドレスのみ。コミット前に `git config user.email` を確認する。
- lint / build / test はルートから実行でき、CI で回す。
- 並行する作業は、`git worktree` で作業ツリーを分ける(同じ作業ディレクトリで並行しない)。作り方、依存の扱い、並列の上限、
  直列にする条件は [CONTRIBUTING.md](CONTRIBUTING.md) の「並行する作業」。
- 失敗と対処は、1 件 1 ファイルで `docs/app/lessons/` に記録する。一般的な注意書きの形で書き、
  出来事を語る書き方にしない。

## 書いてはいけないもの(コード・ドキュメント・コミット・Issue・PR のすべて)

- **機密情報**: 認証情報、アクセスキー、トークン、パスワード、シークレットの値。
- **個人情報**: 氏名、メールアドレス(GitHub の noreply を除く)、電話番号、所属など。
- **環境情報**: AWS のプロファイル名、アカウント ID、リソース ID、ホストゾーン ID、独自ドメイン、証明書 ARN、
  社内・個人環境のパスなど。書くときは `example.com` などのプレースホルダーにする。
- **経緯や外部の名称**: 社外・非公開の名称、このリポジトリの外の事情や経緯を示す語。
  このリポジトリは、最初からこの形で作られたものとして書く。
- 判断に迷う語は、書く前に人に確認する。
- 個人固有の語は、gitignore 済みの `.pr-secrets-denylist` に置く。環境変数は `.env`(gitignore)に置き、
  `.env.example` にはプレースホルダーだけを書く。

## 検査と承認の流れ

文面を書く側(作成役)と確かめる側(検査役)は、別のサブエージェントにする。メインのセッションは起動と実行だけを行う。

| 操作 | 検査 | 人の確認 |
| --- | --- | --- |
| commit | 機械検査 + 検査役。OK ならそのままコミットし、検査した差分を台帳に記録する(`/dev-commit`) | なし |
| push(PR を出さないとき) | 範囲内の全コミット・作者・ブランチ名を検査する。台帳に記録のある差分は読み直さない。OK でも結果を見せて待つ(`/dev-push`) | **必須** |
| PR の起票・編集(push を含む) | 本文を `.drafts/` に書き、範囲の全コミットと本文を 1 回で検査する。OK でも本文と結果を見せて待つ。承認は、push と PR の作成に 1 回(`/dev-pr`) | **必須(1 回)** |
| Issue の起票・編集 | 本文を `.drafts/` に書き、同じ検査。OK でも本文と結果を見せて待つ(`/dev-pr`) | **必須** |
| コメント・ラベルなど | 機械検査のみ | 省略可 |

- 人の許可なく push しない。
- 検査済みの差分は、台帳(`.git` の下)に記録し、push と PR では読み直さない。検査の基準が変わったとき、判定が WARN だったとき、バイナリを含む差分、
  マージコミットを含む範囲は、読み直す。コミットのメッセージと PR の下書きは、毎回読む。
- `packages/pipeline` の変更も、この流れに従う。API キーなどの環境値は `packages/pipeline/.env`(gitignore)にだけ置き、
  `.env.example` にはプレースホルダーだけを書く。
- PR・Issue は `.drafts/` のファイルから投稿する。承認した内容と投稿する内容が同一であることを確認する
  (承認後に編集したら、検査と確認をやり直す)。
- 編集履歴はあとから消せない。「出してから直す」は前提にしない。
- 検査結果は、値を引用せず、場所と種類だけで報告する。
- 差し戻されたとき: 未 push ならコミットを作り直す。push 済みなら、履歴は書き換えず次のコミットで直す。
  値そのものが漏れていた場合だけ、書き換えが必要かを人が判断する。

## 完了の定義(各段階)

- lint / build / test が通る。
- リリースノートとタグが対応している。
- デプロイを伴う段階では、`docs/pre-deploy-checklist.md` をデプロイの前に、`docs/post-deploy-smoke.md` をデプロイの直後に通す。
- 環境固有の値・個人情報・外部の名称が、差分にない。
