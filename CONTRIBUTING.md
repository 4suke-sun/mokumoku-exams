# 開発の進め方

もくもく問題集の開発の進め方です。

## 準備

必要なもの: Node.js 22.18 以上

```sh
npm install   # 依存を入れ、検査フック(.githooks)を有効にします
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run status` | 作業の状態の表示(読み取りだけ)。最新のタグ、開いたマイルストーンと未完了の Issue、開いた PR、未 push のコミット、マージ済みで残ったブランチ、作業ツリー。GitHub の情報(`gh`)や git の情報が取れないときは、取れなかった項目を示して、取れた項目だけを表示する。「マージ済みで残ったブランチ」は、`origin/main` に含まれるブランチのうち、コミットのない新しいブランチ(先頭が `origin/main` と同じ)を除いたもの。作業の開始と再開で実行する |
| `npm run verify` | PR の前に通す検査をまとめて実行する(lint、型検査、`check:*`、データ検査、関係するテスト、関係する build)。失敗した段階を示して止まる。E2E は含まない |
| `npm run lint` | lint と整形の確認(Biome) |
| `npm run format` | lint の自動修正と整形 |
| `npm run typecheck` | 型検査(tsc) |
| `npm run build` | ビルド |
| `npm test` | テスト(Vitest) |
| `npm run test:e2e` | 主要な画面の通し確認(Playwright)。開発サーバーを代替の認証で起動して通す。初回は `npx playwright install chromium` が必要 |
| `npm run check:release-notes` | リリースノートとタグの対応の検査 |
| `npm run validate:data` | 資格マスタ・問題データ・カリキュラム・使い方ページのデータの検査(仕様: `docs/data-spec.md`) |
| `npm run check:lessons` | 学びの記録(`docs/app/lessons/`)の書式の検査。`-- --write` で一覧を更新 |
| `npm run check:test-titles` | テストの題(`it` / `test`)の形の検査。`-- --write` で、直した題を基準から消す |
| `npm run check:docs` | 文書の相対リンクの先と、`npm run <名前>` のスクリプトが実在することの検査(対象: `README.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`docs/`、`.claude/skills/`、`packages/*/README.md`) |
| `npm run check:env` | アプリ(`packages/app`)が読む環境変数が、CDK(`packages/infra/lib/web-stack.ts`)から Lambda へ渡されることの検査。Lambda が自動で与える変数と開発用の変数は、`scripts/lib/env-contract-check.ts` の一覧で除く。通知の送信の Lambda と、動的な参照(`env[変数]` など)は対象にしない |
| `npm run check:pr-closes -- --pr <番号>` | PR の `Closes` の Issue が同じ版のマイルストーンで、リリースノートの最新の版がそのマイルストーンの名前(`vX.Y.Z`)と同じで、マイルストーンに `Closes` にない未完了の Issue がないことの検査(`gh` で読む)。`--body-file <下書き>` で、投稿の前に下書きを検査できる。CI の PR で実行する |

### 手元の検査(PR の前)

PR を出す前に、`npm run verify` を通します。`verify` の各検査は、CI でも別々のジョブで実行されます(`verify` 自体は CI で動きません)。

- `verify` が順に実行するもの: `lint`、`typecheck`、`check:release-notes`・`check:lessons`・`check:test-titles`・`check:docs`・`check:env`・`check:boundary`(CI の `check` ジョブが実行するもの。フック用の `check:branch`・`check:commit` と、`check:pr-closes` は含まない)、`validate:data`、関係するテスト、関係するワークスペースの `build`。失敗した段階の名前を示して、終了コード 1 で止まります。段階ごとの時間も表示します。
- 関係するワークスペース(app / infra / pipeline)は、`origin/main` との差分と、未コミット・未追跡の変更から選びます。`origin/main` がないなど、変更が分からないときは、すべて選びます。選び方は、CI の `changes` ジョブと同じです(指定の文字列が CI とずれないことは、テストが確かめます)。契約(`packages/data-schema`)、ルートの設定、`scripts/`、CI の定義が変わったときは、すべて選びます。`scripts/` のテストと `packages/data-schema` のテストは、常に実行します。
- `verify` に含まないもの: `npm run test:e2e`(ブラウザを使う通し確認で重い。CI の `e2e` ジョブが通す。画面の動きを変えたときは、手元でも実行する)、`check:pr-closes`(PR の番号が要る。PR の前は `npm run check:pr-closes -- --body-file <下書き>` で下書きを検査する)。

### CI が動かすジョブ

CI の `changes` ジョブが、変更したパスから、動かすジョブを決めます(`scripts/ci-changes.test.ts` が、変更したパスごとの結果を確かめます)。

| 動かすジョブ | 変更したパス |
| --- | --- |
| `app`(ビルド、`build:lambda`、テスト) | `packages/app/`、`data/`(`data/release-notes.json` だけの変更でも動く。アプリがこのファイルを読むため) |
| `e2e` | `packages/app/`、`data/`(`data/release-notes.json` だけの変更では動かない) |
| `infra` | `packages/infra/` |
| `pipeline` | `packages/pipeline/`、`docs/`、`.claude/agents/`、`data/exams.json`(pipeline のテストが読むファイル) |
| すべて | ルート直下のファイル、`.github/`、`scripts/`、`packages/data-schema/`、`main` への push |

E2E の試験は、再試行なしで通ることを求めます。CI は、失敗した試験を 1 回やり直しますが、やり直して通った試験は、失敗として扱います(`failOnFlakyTests`)。新しい試験は、`npx playwright test <ファイル> --repeat-each=<回数> --retries=0` で繰り返し実行して、通ることを確かめます。

### テストが止まる・遅いとき

全部のテスト(`npm test`)は、ルートの `scripts/` のテストのあと、各ワークスペースのテストを順に実行します。手元の一般的な環境で、数十秒で終わる目安です。1 件のテストが 1 秒を超えることは、まれです(最も遅いのは、git や node の子プロセスを起動するテスト)。終わらないプロセスは、`--reporter=hanging-process` で探せます。

止まる、または遅いときは、次の順に切り分けます。

1. 負荷を確かめる。ほかのテストの並行実行、開発サーバー、E2E、ブラウザが動いていると、子プロセスを起動するテストが遅くなります。並行して実行せず、`npm run verify` を 1 つだけ実行します。
2. 終わらないプロセスを探す: `npx vitest run --reporter=hanging-process`(ワークスペースの中では、そのワークスペースのテストだけを調べる)。
3. 遅いテストを探す: `npx vitest run --reporter=verbose`。
4. 子プロセスを起動するテストのタイムアウトは、ルートが 30 秒(`vitest.config.ts`)、スタックの合成(`packages/infra`)が長く設定してあります。これを延ばして直す前に、上の 1〜3 で原因を確かめます。

## ブランチ

ブランチ名は `<prefix>/#<Issue番号>-<短い説明>` にします。`prefix` は、コミットの種類(`feat`、`fix`、`chore`、`docs`、`test`、`ci`)に合わせます。

例: `feat/#12-exam-list`

## コミット

[Conventional Commits](https://www.conventionalcommits.org/) の形式で書きます。

```text
feat: 資格の一覧画面を作る

- 本文は、何を行うか・何があるかを、箇条書きで書く

Closes #12
```

- `Closes #<番号>` は、番号ごとに 1 行ずつ書きます(カンマ区切りは、最初の 1 つしか閉じません)。
- 作者のメールアドレスは、GitHub の noreply アドレスにします。

## テスト

テストの題(`it` / `test`)は、日本語で「前提条件_期待結果」の形にします。

- 最初の `_` の前に前提条件、後に期待結果を書きます。どちらも空にしません。`_` は、題の中に 2 つ以上あってもかまいません。
- 例: `未ログイン_ログインの画面へ送られる`
- 対象は `it` と `test`(`it.each` と `it.skip` を含む)です。`describe` の題は対象にしません。
- 検査が読めない書き方は、対象にしません。行頭から始まらない `it(`、括弧が 2 段以上入れ子になった修飾の引数(`it.each(…)` など)が該当します。
- 検査: `npm run check:test-titles`(CI の `check` ジョブでも実行します)。
- 既存の題で規約に合わないもの(`scripts/test-title-baseline.json` に記録)は、止めません。新しい題と、変えた題が規約に合わないと止めます。
  題を直したときは、`npm run check:test-titles -- --write` で、基準から消します。`--write` で基準に足すことはできません(手で足した行は、レビューで見ます)。

## 検査フック

コミットと push の前に、次を機械的に検査するフックが動きます。

- 機密情報・環境固有の値・個人情報らしき内容(追加行・ファイル名・コミットメッセージ・作者)
- 変更に含めてはいけないファイル(エディタの設定、下書き、`.env` など)
- 追加・変更した画像(PNG・JPEG)に埋め込まれたメタデータ(位置情報、作成者・端末・ソフトウェアの名前、テキストなど)。書き出すときに取り除いてください。
- コミットメッセージと PR・Issue の下書きにある、Claude のセッションへのリンク(`Claude-Session:` の行など)
- `main` への直接の commit(`npm run check:branch`)。作業ブランチを作ってから commit します。detached HEAD(リベース中を含む)は止めません。

コミットの前には、これに加えて、ステージしたファイルの lint と整形も検査します。push の前の lint は、CI が担当します。

フックが止めたら、指摘された場所を直してください。`--no-verify` は使いません。

### 拒否リスト

個人固有の語(氏名など)は、リポジトリに入れず、手元の拒否リスト `.pr-secrets-denylist`(gitignore 済み)で検査します。

- 置き場: 主の作業ツリーの直下。`git worktree add` で作った作業ツリーでも、主の作業ツリーのリストが効きます。作業ツリーの直下にもあれば、両方の語を合わせます。
- 書式: 1 行 1 語。`#` で始まる行はコメント、空行は無視します。語を持たない場合は、コメントだけのファイルで構いません。
- 見つからないとき: 手元(環境変数 `CI` がない環境)では、検査が止まり、置き場と書式を案内します。CI にはリストを置かないので、空のリストで続けます。

## 並行する作業(作業ツリー)

複数のセッションが同じ作業ディレクトリでブランチを切り替えると、互いの未コミットの変更やチェックアウト中のブランチを壊します。並行する作業は、`git worktree` で作業ツリーを分けます(推奨。同じ作業ディレクトリで並行しない)。

- 作り方: `git worktree add <親ディレクトリ>/wt-<版またはIssue番号> -b <prefix>/#<Issue番号>-<説明> origin/main`
    - 親ディレクトリは、リポジトリの外の決まった場所にします(パスは環境ごとに異なるので、文書には書きません)。
    - 1 つのブランチは、1 つの作業ツリーにだけ出せます。ブランチ名は、`## ブランチ` の規約のままです。
- 依存: 作業ツリーごとに `npm ci` はしません。主の作業ツリーの `node_modules` を、作業ツリーの直下へコピーします(macOS では `cp -cR` で、容量を使わずに複製できます)。
    - `node_modules` ごとシンボリックリンクで共有しません。`node_modules/@mokumoku-exams/*` は、`../../packages/*` への相対リンクで、共有すると共有元の `packages/` を指し、作業ツリーで変えた内容(特に `packages/data-schema`)が、ほかのワークスペースから見えなくなります。コピーなら、リンクは作業ツリーの `packages/` を指します。
    - 依存(`package-lock.json`)を変える版は、コピーのあとに `npm ci` で入れ直します。
- 個人設定: `.env` などの gitignore 済みのファイルは、作業ツリーに複製されません。必要なものは、作業ツリーの直下へコピーします。
- 拒否リスト: 主の作業ツリーの `.pr-secrets-denylist` が、作業ツリーでも効きます(`### 拒否リスト`)。複製は要りません。
- 並列の上限: 実装を担当するサブエージェント(実装役)は、同時に 2 体までにします。
- 直列にする条件: 同じ画面やデータに触る版は、並列にせず、直列にします。触る範囲が重なるかは、各版の変更予定のパス(`packages/app/src/app/` の同じ画面、`data/` の同じファイル、`packages/data-schema/`)を比べて見分けます。重なれば直列です。
- リリースノート: どの版も `data/release-notes.json` の先頭にエントリを足すので、並列の版は同じ位置が変わります。版の順にマージし、あとの版は、前の版のマージのあとの `main` を取り込んで、競合を解消してからマージします。
- 長い作業: 端末のスリープで作業が止まらないよう、スリープを防ぎます(macOS では `caffeinate -i <コマンド>`)。
- 後始末: 作業ツリーの削除(`git worktree remove`)は、版のマージとタグのあとに、最後にまとめて行います。未コミットの変更がないことを確かめてから消します。

## 書いてはいけないもの

コード・ドキュメント・コミット・Issue・PR のすべてで、次を書きません。

- 認証情報(アクセスキー、トークン、パスワードなど)
- 環境固有の値(プロファイル名、アカウント ID、ドメイン、証明書の ARN など)。説明に必要なときは、`example.com` や `<プロファイル名>` のようなプレースホルダーにします。
- 個人情報(氏名、メールアドレス、パスなど)

環境固有の値は、`.env`(gitignore 済み)に置きます。`.env.example` には、プレースホルダーだけを書きます。

## Pull Request

- PR は、原則、**版単位**です。1 つの版(例: v0.2.0)を 1 つの PR にまとめ、その版の Issue を `Closes` で閉じます。
- 不具合の修正や hotfix は、Issue 単位の PR でかまいません。
- PR のタイトルも、Conventional Commits の形式にします。
- `main` への直接 push は、しません。このリポジトリの現在のプランでは、ブランチ保護(PR の必須化)が使えないため、`main` への push のたびに、CI が機密検査を実行して検知します(止めるものではなく、検知して直すためのものです)。ブランチ保護が使えるようになったら、PR の必須化に切り替えます。
- 版を切る PR には、`data/release-notes.json` にその版のエントリを足します(新しい版を先頭に)。
- 版単位の PR は、`Closes` の Issue をすべて同じ版のマイルストーンにし、そのマイルストーンに `Closes` にない未完了の Issue を残しません(`npm run check:pr-closes` が CI で守ります)。`Closes` の Issue がどれもマイルストーンを持たない PR は、Issue 単位の PR(hotfix)として、検査しません。検査は PR の作成と更新(push)で動きます。PR の本文や、Issue のマイルストーンを直したときは、CI の `pr-closes` ジョブを再実行します。

## 版番号

版番号は、[セマンティックバージョニング](https://semver.org/lang/ja/)に従い、`vメジャー.マイナー.パッチ` の形にします。

| 桁 | 上げるとき |
| --- | --- |
| メジャー | 互換性のない破壊的な変更を含むとき(v1.0.0 以降)。ベータの間は 0 のままです |
| マイナー | 互換性を保つ機能を追加するとき。機能を含む版は、規模にかかわらず、必ずマイナーを上げます |
| パッチ | 互換性を保つバグ修正のみのとき |

## リリース

版の PR をマージし、タグ・Release・マイルストーン・ブランチの削除までは、`scripts/release.ts` で行います(スキル: `.claude/skills/dev-release`)。マージ・タグ・ブランチの削除は、人の明示の指示ごとに行います。

```sh
npm run release -- <PR の番号> --check   # マージの前の確認だけ(GitHub とファイルの内容は変えない。リモートの情報の取得 `git fetch` で、ローカルの追跡の参照とタグは更新する)
npm run release -- <PR の番号>           # マージから確認の一覧まで
```

- 順に行うこと: CI と PR の状態の確認(全ジョブが成功か、変更がなく動かなかった(skipped、neutral)で、`ci-ok` が成功で、`CLEAN`)→ マージ(マージコミット。確認した PR の先頭のコミットに固定する)→ マージコミットの `data/release-notes.json` の先頭が対象の版であることの確認 → マージコミットへの軽量タグの作成と push → タグの push で `release-tag.yml` が作る Release(リモートに同名のタグがあれば、`fetch --tags` でローカルに取り込まれ、マージコミット以外を指すときは、衝突として止まります) の確認 → 版と同名のマイルストーンを閉じる(未完了の Issue があれば、閉じずに止まる)→ 作業ブランチの削除(リモートとローカル。次は残す: `main`・`dev` などの保護対象の名前、フォークからの PR、リモートの先頭が PR の先頭から動いたブランチ、別の作業ツリーで出ているブランチ、`origin/main` に含まれないブランチ)→ `Closes` の Issue と `main` の確認。段階ごとの結果は表で表示します。
- 再実行してよい作りです。タグ・Release・閉じたマイルストーン・消えたブランチは、「済み」として扱います。失敗した段階(未完了の Issue が残るマイルストーンを含む)で止まり、どの段階まで終えたかを表示します。
- Release は、タグの push で `release-tag.yml` が作ります(リリースノートのエントリが本文になります)。スクリプトは、作られるまで待って確かめます。タグとリリースノートは、1 対 1 で対応します。
- スクリプトの呼び出しは、`.claude/settings.json` の確認必須(`ask`)に入っています。権限の確認を省く動作モードでは確認にならないので、人の明示の指示をスキルの中で確かめます。
- 版の締めでは、この版で引っかかったことを振り返り、再発を防ぐ形(機械検査、共通の決まり、スキルの手順、`docs/app/lessons/`)にします(スキルの Step 4)。

### リポジトリの設定

マージのあと、作業ブランチが残らないように、次の設定にします。

| 設定 | 値 | 確かめ方 |
| --- | --- | --- |
| マージ後にブランチを自動で消す(`delete_branch_on_merge`) | 有効 | `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge` が `true` |
| マージの方式 | マージコミットだけ(`allow_merge_commit` が `true`、`allow_squash_merge` と `allow_rebase_merge` が `false`) | `gh api repos/{owner}/{repo} --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` |

設定の変更は、リポジトリの管理者の操作です(`gh api -X PATCH repos/{owner}/{repo} -F delete_branch_on_merge=true -F allow_squash_merge=false -F allow_rebase_merge=false`)。実行の前に、人の確認を取ります。
