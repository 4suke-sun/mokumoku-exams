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
| `npm run test:all` | ルートの `scripts/` と、すべてのワークスペースのテストを、途中で失敗しても止めずに最後まで流し、段階ごとの結果をまとめて出す。1 つでも失敗したら終了コード 1(失敗した段階はすべて挙げる)。E2E は含まない。`npm test` と `verify` は、最初の失敗で止まる |
| `npm run lint` | lint と整形の確認(Biome) |
| `npm run format` | lint の自動修正と整形 |
| `npm run typecheck` | 型検査(tsc) |
| `npm run build` | ビルド |
| `npm test` | テスト(Vitest) |
| `npm run test:e2e` | 主要な画面の通し確認(Playwright)。開発サーバーを代替の認証で起動して通す。初回は `npx playwright install chromium` が必要 |
| `npm run check:release-notes` | リリースノートとタグの対応の検査 |
| `npm run validate:data` | 資格マスタ・問題データ・非公開の問題・カリキュラム・体系ノート・コードドリル・要約カード・使い方ページのデータの検査(仕様: `docs/data-spec.md`) |
| `npm run lessons -- <add\|list\|repeats\|draft\|close\|closed>` | 引っかかりの受け箱(`.git` の共有領域)の記録と集計。手順は `docs/lessons-workflow.md` |
| `npm run metrics` | 手元の計測の集計(`verify` の段階ごとの時間、サブエージェントの時間とトークン、検査の台帳の内訳)。`-- agent <役> <ミリ秒> <トークン>` で記録を足す |
| `npm run agent-cost -- [--since <日付>] [--until <日付>] [--dir <置き場>]` | Claude Code のセッション記録(jsonl)から、エージェント定義ごと・モデルごとのトークンと API 換算の費用(見積もりで、請求額ではない)、起動分、メインの 1 リクエストあたりの読み込み量を集計する(読み取りだけ)。日付は `YYYY-MM-DD`(どちらもその日を含む)。既定の置き場は、リポジトリと作業ツリーのセッションの記録(`CLAUDE_CONFIG_DIR` か `~/.claude/projects/` の下)で、`--dir` で指定もできる。単価表は `scripts/data/model-prices.json`。出力に記録の本文・パス・セッションの識別子は出さない。手で足す計測(`npm run metrics` の `agent`)とは併用する。手順は `docs/lessons-workflow.md` の「計測」 |
| `npm run -s mask` | 標準入力の出力から値を伏せて出す(コミット・push・PR の検査と同じ正規表現と許可されていないメールアドレス、数字だけの 12 桁、`.env` の 4 文字以上の値、拒否リストの語。伏せきれない行は出さない)。合成と差分の出力を読むときに通す。伏せない形と注意は `docs/app/lessons/0004-mask-diff-output.md` |
| `npm run check:lessons` | 学びの記録(`docs/app/lessons/`)の書式の検査。`-- --write` で一覧を更新 |
| `npm run check:test-titles` | テストの題(`it` / `test`)の形の検査。`-- --write` で、直した題を基準から消す |
| `npm run check:docs` | 文書の相対リンクの先と、`npm run <名前>` のスクリプトが実在することの検査(対象: `README.md`、`CLAUDE.md`、`CONTRIBUTING.md`、`docs/`、`.claude/skills/`、`packages/*/README.md`) |
| `npm run check:env` | アプリ(`packages/app`)が読む環境変数が、CDK(`packages/infra/lib/web-stack.ts`)から Lambda へ渡されることの検査。Lambda が自動で与える変数と開発用の変数は、`scripts/lib/env-contract-check.ts` の一覧で除く。通知の送信の Lambda と、動的な参照(`env[変数]` など)は対象にしない |
| `npm run check:ui-patterns` | 画面の書き方の型の検査(アプリの画面の部品と CSS。`transition: all`、ホバーの拡大、無限に繰り返す動き、極太・斜体・英字の大文字と字間、全角の「！」、グラデーション、半端な余白、待機メッセージの文型、絵文字、1 辺だけの太い色線、丸い錠剤形、色の直書き、本文の行間など。決まりは `docs/app/design-tone.md` の「型を除く決まり」)。意図して残す箇所は、`scripts/lib/ui-patterns-check.ts` の許可の一覧に、理由つきで置く(件数が合わないと止める)。報告は場所と種類だけ |
| `npm run check:pr-closes -- --pr <番号>` | PR の `Closes` の Issue が同じ版のマイルストーンで、リリースノートの最新の版がそのマイルストーンの名前(`vX.Y.Z`)と同じで、マイルストーンに `Closes` にない未完了の Issue がないことの検査(`gh` で読む)。`--body-file <下書き>` で、投稿の前に下書きを検査できる。CI の PR で実行する |

### 手元の検査(PR の前)

PR を出す前に、`npm run verify` を通します。`verify` の各検査は、CI でもそれぞれ実行されます(`check:*` は CI の `check` ジョブのステップ(build のあとの `check:unpublished-bundle` だけは `app` ジョブのステップ)、ワークスペースごとのテストは `app`・`infra`・`pipeline` のジョブ(`data-schema` のテストは `check` ジョブ)、build は `app` のジョブ。`verify` 自体は CI で動きません)。

- `verify` が順に実行するもの: `lint`、`typecheck`、`check:release-notes`・`check:lessons`・`check:test-titles`・`check:docs`・`check:env`・`check:boundary`・`check:retired-ids`・`check:ui-patterns`(CI の `check` ジョブが実行するもの。フック用の `check:branch`・`check:commit` と、`check:pr-closes` は含まない)、`validate:data`、関係するテスト、関係するワークスペースの `build`、アプリを選んだときは、build のあとの `check:unpublished-bundle`(非公開の問題がビルド成果物に含まれないこと)。失敗した段階の名前を示して、終了コード 1 で止まります。段階ごとの時間も表示します。
- 関係するワークスペース(app / infra / pipeline)は、`origin/main` との差分と、未コミット・未追跡の変更から選びます。`origin/main` がないなど、変更が分からないときは、すべて選びます。選び方は、CI の `changes` ジョブと同じです(指定の文字列が CI とずれないことは、テストが確かめます)。契約(`packages/data-schema`)、ルートの設定、`scripts/`、CI の定義が変わったときは、すべて選びます。`scripts/` のテストと `packages/data-schema` のテストは、常に実行します。
- テストが途中で止まったとき(失敗や、時間の上限による中断)は、止まった 1 件だけを流し直して通っても、後ろのテストの結果は分かりません。ワークスペースごとにすべて流し直して、全件の結果を確かめてから push します。`npm run test:all` で、最初の失敗で止まらずに、すべての結果を 1 回で見られます。ただし、終わらない段階があると、`test:all` もそこで止まります(時間の上限は設けていません)。その段階は、「テストが止まる・遅いとき」の手順で原因を確かめます。
- `verify` に含まないもの: `npm run test:e2e`(ブラウザを使う通し確認で重い。CI の `e2e` ジョブが通す。画面の動きを変えたときは、手元でも実行する)、`check:pr-closes`(PR の番号が要る。PR の前は `npm run check:pr-closes -- --body-file <下書き>` で下書きを検査する)。

### CI が動かすジョブ

CI の `changes` ジョブが、変更したパスから、動かすジョブを決めます(`scripts/ci-changes.test.ts` が、変更したパスごとの結果を確かめます)。

| 動かすジョブ | 変更したパス |
| --- | --- |
| `app`(ビルド、`build:lambda`、`check:unpublished-bundle`、テスト) | `packages/app/`、`data/`(`data/release-notes.json` だけの変更でも動く。アプリがこのファイルを読むため) |
| `e2e` | `packages/app/`、`data/`(`data/release-notes.json` だけの変更では動かない) |
| `infra` | `packages/infra/` |
| `pipeline` | `packages/pipeline/`、`docs/`、`.claude/agents/`、`data/exams.json`(pipeline のテストが読むファイル) |
| すべて | ルート直下のファイル、`.github/`、`scripts/`、`packages/data-schema/`、`main` への push |

E2E の試験は、再試行なしで通ることを求めます。CI は、失敗した試験を 1 回やり直しますが、やり直して通った試験は、失敗として扱います(`failOnFlakyTests`)。新しい試験は、`npx playwright test <ファイル> --repeat-each=<回数> --retries=0` で繰り返し実行して、通ることを確かめます。

画面を開く操作(リンクやボタンを押して別の画面へ移る確認)は、押し直しと長めの待ちの形にそろえます。ログイン、ログアウト、採点のように、サーバーへの送信を伴う操作は、この形の対象にしません(押し直すと送信が重なるため。それぞれ `login`、ログアウトの試験、`answerAndFinish` が押します)。この形の書き方は、`packages/app/e2e/smoke.spec.ts` の `clickUntilUrl` にあります([失敗の記録 0013](./docs/app/lessons/0013-e2e-navigation-wait-retry.md))。E2E は、代替の認証(`AUTH_FAKE`)が開発サーバーでだけ有効なので、本番のビルドでは回しません。

### テストが止まる・遅いとき

全部のテスト(`npm test`)は、ルートの `scripts/` のテストのあと、各ワークスペースのテストを順に実行します。手元の一般的な環境で、数十秒で終わる目安です。1 件のテストが 1 秒を超えることは、まれです(最も遅いのは、git や node の子プロセスを起動するテスト)。終わらないプロセスは、`--reporter=hanging-process` で探せます。

止まった、または落ちたときは、直す前に、`npm run test:all` で全件の結果を確かめます(どのワークスペースが失敗しているかを、まとめて見ます)。止まる、または遅いときは、次の順に切り分けます。

1. 負荷を確かめる。ほかのテストの並行実行、開発サーバー、E2E、ブラウザが動いていると、子プロセスを起動するテストが遅くなります。並行して実行せず、`npm run verify` を 1 つだけ実行します。
2. 終わらないプロセスを探す: `npx vitest run --reporter=hanging-process`(ワークスペースの中では、そのワークスペースのテストだけを調べる)。
3. 遅いテストを探す: `npx vitest run --reporter=verbose`。
4. 子プロセスを起動するテストのタイムアウトは、ルートが 60 秒で、同時に動くワーカーを CPU の半分に絞ってあります(ルートの `vitest.config.ts`)。作問パイプライン(`packages/pipeline`)は 30 秒(その `vitest.config.ts`)、スタックの合成(`packages/infra`)が長く設定してあります。これを延ばして直す前に、上の 1〜3 で原因を確かめます。

## ブランチ

ブランチ名は `<prefix>/#<Issue番号>-<短い説明>` にします。`prefix` は、コミットの種類(`feat`、`fix`、`chore`、`docs`、`test`、`ci`)に合わせます。

例: `feat/#12-exam-list`

版のブランチ(1 つの版の Issue をまとめるブランチ)は、名前の番号を、版で最初に着手する Issue の番号にして、説明に版を使います(例: `chore/#352-v0.59.0`)。
そのブランチのコミットの `Closes` と `Refs` は、そのコミットが扱う Issue の番号で、ブランチ名の番号と違ってかまいません。版のすべての Issue は、PR の `Closes` で閉じます。

## コミット

[Conventional Commits](https://www.conventionalcommits.org/) の形式で書きます。

```text
feat: 資格の一覧画面を作る

- 本文は、何を行うか・何があるかを、箇条書きで書く

Closes #12
```

- `Closes #<番号>` は、番号ごとに 1 行ずつ書きます(カンマ区切りは、最初の 1 つしか閉じません)。
- 作者のメールアドレスは、GitHub の noreply アドレスにします。Claude の署名の行(`Co-Authored-By:`)で使う noreply アドレスも認めます(完全一致だけ)。

## テスト

テストの題(`it` / `test`)は、日本語で「前提条件_期待結果」の形にします。

- 最初の `_` の前に前提条件、後に期待結果を書きます。どちらも空にしません。`_` は、題の中に 2 つ以上あってもかまいません。
- 例: `未ログイン_ログインの画面へ送られる`
- テストの仮の秘密の値は、直接書かず、値を連結などで組み立てて、定数に置いてから使います。コミットの機械検査は、`secret`・`api_key`・`access_token`・`password` の語(大文字小文字と、`-`・`_` の有無の違いを含む)のあとに、空白をはさんでもよい `:` か `=` が続き、空白を含まない 8 文字以上の引用符つきの値が続く形を止めます。定数の名前にも、これらの語を使いません([失敗の記録 0001](./docs/app/lessons/0001-test-dummy-values-concat.md))。
- 対象は `it` と `test`(`it.each` と `it.skip` を含む)です。`describe` の題は対象にしません。
- 検査が読めない書き方は、対象にしません。行頭から始まらない `it(`、括弧が 2 段以上入れ子になった修飾の引数(`it.each(…)` など)が該当します。
- 検査: `npm run check:test-titles`(CI の `check` ジョブでも実行します)。
- 既存の題で規約に合わないもの(`scripts/test-title-baseline.json` に記録)は、止めません。新しい題と、変えた題が規約に合わないと止めます。
  題を直したときは、`npm run check:test-titles -- --write` で、基準から消します。`--write` で基準に足すことはできません(手で足した行は、レビューで見ます)。

カバレッジ:

- app のテストのカバレッジは、`npm run test:coverage -w @mokumoku-exams/app` で測ります(行・文・関数・分岐の割合)。
- CI の `app` ジョブも同じ方法で測り、ログと、ジョブのまとめ(Summary)に値を出します。値を見るためのもので、しきい値は設けず、下がっても止めません。

アクセシビリティ:

- E2E は、ログイン・資格の一覧・セクションの一覧・出題・結果の画面を、axe(`@axe-core/playwright`)で自動検査します。
- 基準は WCAG 2.1 の A と AA で、違反が 1 つでもあれば失敗にします。報告は、規則の ID と件数だけです。
- 表示の動き(フェードイン)の途中を検査しないよう、動きを減らす設定(`prefers-reduced-motion: reduce`)で開きます。

## 検査フック

コミットと push の前に、次を機械的に検査するフックが動きます。

- 機密情報・環境固有の値・個人情報らしき内容(追加行・ファイル名・コミットメッセージ・作者)
- 変更に含めてはいけないファイル(エディタの設定、下書き、`.env` など)
- 追加・変更した画像(PNG・JPEG)に埋め込まれたメタデータ(位置情報、作成者・端末・ソフトウェアの名前、テキストなど)。書き出すときに取り除いてください。
- コミットメッセージにある、Claude のセッションへのリンク(`Claude-Session:` の行など)。コミットのとき(`commit-msg`)だけで、push の検査では見ません。PR・Issue の下書きは、フックではなく、`dev-pr` の Step 2 で `scripts/check-pr-secrets.ts` を手で実行して、同じ検査をします
- `main` への直接の commit(`npm run check:branch`)。作業ブランチを作ってから commit します。detached HEAD(リベース中を含む)は止めません。

コミットの前には、これに加えて、ステージしたファイルの lint と整形も検査します。push の前の lint は、CI が担当します。

フックが止めたら、指摘された場所を直してください。`--no-verify` は使いません。

### 承認の印(Claude Code のフック)

Claude Code からの push と、`gh` での PR・Issue の作成、題・本文の編集は、人の承認の印がないと、PreToolUse のフック(`scripts/approval-hook.ts`。`.claude/settings.json`)が止めます。
権限の確認(`ask`)は、権限の確認を省く動作モードでは確認にならないため、フックで止めます。

守る範囲は、**うっかりした操作と、権限の確認を省くモードでの素通り**です。コマンドの文字列を読んで判定するので、書き方を変えてわざと抜ける形(下の「見分けられない形」)は、対象外です。対象は、push と、PR・Issue の作成と題・本文の編集だけです。`gh pr merge`・`gh pr close`・`gh issue close` は、`ask` の設定だけが守ります。

- 印は、スキル(`/dev-push`、`/dev-pr`)で人の承認を得た直後に、メインのセッションが `node scripts/approval.ts grant push`、`grant pr <下書き>`、`grant issue <下書き>` で書きます(`pr`・`issue` は下書きが必須です)。
  置き場は `.git` の下(追跡されない)で、有効期限は 60 分です。`status` で確かめ、`revoke` で消せます。
  フックが確かめるのは、印の有無と、範囲・下書きの一致です。人が承認したこと自体は、フックでは確かめられません(スキルの手順が担います)。
- 通す条件:
    - push と PR は、ブランチ、範囲の末尾のコミット、コミット数が、承認のときと一致するとき。
    - PR と Issue の作成と、題・本文の編集は、コマンドに出る `.drafts/` の下書きのファイルの内容が、承認のときと一致するとき。
      下書きのファイルを指さないものと、本文の直書き(`--body`、`-b`。`-bX` のように値を続けた形を含む)は通しません。
      本文のファイル指定(`--body-file`、`-F`)は 1 つだけで、値は `.drafts/` から始まる相対パス(`..` を含まない。`<(…)` は可)に限ります。標準入力(`-`)、絶対パス、`./` から始まるパスは通しません。`<(…)` の中身は確かめません(同じコマンドに、承認した下書きのパスがあることだけを確かめます)。
      題は、値の全体が `$(…)` の形(手順は `--title "$(head -n 1 <下書き>)"`)を通し、直書き(`--title`、`-t` に値を続けた形)は通しません。`$(…)` の中身が、承認した下書きを読むかどうかは確かめません。
    - ラベルやマイルストーンだけの編集は、軽い操作として通します。
    - 承認は、使っても消えません。有効な 60 分の間は、同じ範囲・同じ下書きで何度でも通ります。PR・Issue の番号と、PR の `--base` は、承認が覆いません。
    - Issue の承認は、直前の 1 件だけが有効です。下書きを複数投稿するときは、1 件ごとに印を書き直します。
- サブエージェントからの呼び出しは、承認の印があっても止めます(フックの入力の `agent_id` で見分けます。`agent_id` と、`cd` のあとの作業ディレクトリを指す `cwd` の出典: 公式の文書の hooks の「Common input fields」。導入したバージョンは、文書に書かれていません)。印のファイルの名前を含むコマンドも止めます。
- 承認の印があっても、常に止めます。必要なときは、人が自分で実行します(`!`。人が `!` で実行する操作には、フックは動きません)。
    - 強制 push(`--force…`、`-f`、`+<ref>`)、`git commit` の `-n`・`--no-verify`
    - ブランチの削除(`--delete`、`-d`、`:<ref>`)、`--all`・`--mirror`・`--prune`
    - タグの push(`refs/tags/…`(`<送り元>:refs/tags/…` を含む)、`--tags`、`--follow-tags`)
    - `commit`・`switch`・`checkout`・`reset`・`merge`・`rebase`・`cherry-pick`・`revert`・`pull`・`am` と、push・PR・Issue の操作を、同じコマンドに置く形(照合は実行の前の状態で行うため)。
    - 本文の出どころや PR のヘッドを変える `gh` のオプション(`--template`・`-T`、`--recover`、`--head`・`-H`)。
    - `cd`・`pushd` と同じコマンドにある push、PR・Issue の操作。`cd` は、コマンドの先頭、区切り・括弧・引用符のあと、`then`・`do`・`else`・`elif`・`if`・`while`・`until`・`command`・`builtin`・`time`・`exec` のあとにあるものを見ます。作業ツリーを指定する push(`-C`、`--git-dir`、`--work-tree`。環境変数 `GIT_DIR`・`GIT_WORK_TREE` で指す形は見分けません)。印は `.git` の共通の領域に 1 つのファイルとして置かれ、作業ツリーで共有されます。効くのは、ブランチ、末尾のコミット、コミット数が一致する範囲だけです。
- 見るコマンド: 先頭が `git`・`gh` の呼び出し(`/usr/bin/git` や `\git` を含む)。区切り(`;`、`&&`、`||`、`|`、`&`、改行、`$(…)`、波かっこ)のあとと、`if`・`then`・`do`・`!` などの予約語のあとも見ます。
  ラッパー(`env`、`sudo`、`nohup`、`xargs`、`time`、`timeout`、`nice`、`caffeinate`、`setsid`、`exec`、`command`、`builtin`)と、`bash -c "…"` の中身は、外して見ます。語の前後の引用符は外して見ます(`git 'push'` も拾います)。`gh` の `create` の別名 `new` も、作成として見ます。`gh` は `-R <リポジトリ>` を飛ばして、`pr`・`issue` と動作を見ます。
- 見分けられない形(権限の確認(`ask`。確認を省く動作モードでは効きません)と `deny` の設定、スキルの手順、スクリプト自身の封印が補います):
    - 文字列を組み立てて実行する形: `eval`、`| sh`、ヒアストリング、変数に入れたコマンド、git の別名、`git send-pack` など。
    - `$(…)` などで組み立てた、push の送り先の指定。静的に書いた指定(`origin <名前>`、`<元>:<先>`、`HEAD`)は、承認したブランチを同じ名前で送るものだけ通します。
    - PR・Issue の番号は、印が覆いません(承認した下書きで、別の番号の PR・Issue を編集できます)。`gh pr create --fill` で本文を作る形は、同じコマンドに下書きの読み取りがあれば通ります。
    - `gh api` で PR や Issue を作る形。`git -c <設定>=…` や環境変数でコミットの検査を飛ばす形。
    - `node scripts/approval.ts grant …` 自体は、`ask` にもフックにも入っていません。メインのセッションが人の承認なしに印を書くことは、止められません(承認の確認は、スキルの手順です)。
    - 承認したブランチと同じ名前のタグの push(ブランチと区別できません)。`git push origin v1.0.0` のような別の名前は、送り先が違うものとして止まります。
    - 承認の印のファイル名を、ワイルドカードや分割で書く形。`cd scripts` で移動してから印を書く形。
    - フックのスクリプトや `.claude/settings.json` の書き換え。止めるのは、印のファイルへの Write・Edit だけです(`deny` の設定は Bash の git の形だけで、Write・Edit には効きません)。`MultiEdit` や `NotebookEdit` も対象外です。
    - 同じコマンドの中で、下書きを書き換えてから投稿する形(照合は、コマンドを実行する前です)。
    - 行の継続(`git \` の次の行に `push`)、`env -S "…"` の中身、`-C../x` のように値を連結した形。`<(…)` の中身(別のファイルを足す形)。
    - `scripts/post-issues.ts` と `scripts/release.ts` が中で行う `gh`・`git push`。前者は封印(下書きと一覧のハッシュ)、後者は人の指示と `ask` で担保します。
- 止めすぎる形があります。`git push --dry-run` も、承認の印を要します。コミットメッセージなどの引用符の中に、`git push` や `commit` の語が、括弧で挟まれて、または `;`・`&&` のあとに出ると、別のコマンドとして見て、止めることがあります。そのときは、メッセージをファイルから渡すなど、書き方を変えてください。
- フックの失敗(入力が読めない、git が動かないなど)は、止める側に倒します(終了コード 2 と `onFailure: "block"`。`onFailure` は Claude Code v2.1.295 以降の設定です)。
  フックの起動コマンドは `git rev-parse --show-toplevel` を使うので、リポジトリの外で Bash・Write・Edit を使うと、すべて止まります。

### 拒否リスト

個人固有の語(氏名など)は、リポジトリに入れず、手元の拒否リスト `.pr-secrets-denylist`(gitignore 済み)で検査します。

- 置き場: 主の作業ツリーの直下。`git worktree add` で作った作業ツリーでも、主の作業ツリーのリストが効きます。作業ツリーの直下にもあれば、両方の語を合わせます。
- 書式: 1 行 1 語。`#` で始まる行はコメント、空行は無視します。語を持たない場合は、コメントだけのファイルで構いません。
- 見つからないとき: 手元(環境変数 `CI` がない環境)では、検査が止まり、置き場と書式を案内します。CI にはリストを置かないので、空のリストで続けます。

## 依存の更新

依存の更新の PR は、Dependabot が週に 1 回出します(`.github/dependabot.yml`)。npm(すべてのワークスペースが共有する、リポジトリ直下のロックファイル)と
GitHub Actions を、それぞれ 1 件の PR にまとめます。題とコミットメッセージは Conventional Commits の形(`chore(deps): …`、`ci(deps): …`)です。

- 更新の PR は、そのままはマージしません。ブランチ名の規約(`<prefix>/#<Issue番号>-…`)にも、版単位の PR とリリースノートの対応にも合わないためです。
- 次の版のブランチで、同じ更新を取り込みます(`npm update` などで同じ版にし、lint / build / test と E2E を通す)。取り込んだ版のリリースノートに書き、
  更新の PR は、取り込んだことを書いて閉じます。
- 急ぐ更新(脆弱性の修正など)は、Issue を立てて、Issue 単位の PR で取り込みます。

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
- リリースノート: どの版も `data/release-notes.json` の先頭にエントリを足すので、並列の版は同じ位置が変わります。版の順にマージし、あとの版は、前の版のマージのあとの `main` を取り込んで、競合を解消してからマージします。この取り込みのコミットでは、検査の入力が、競合を解消したファイルだけに絞られます(`/dev-commit` の Step 3)。
- 長い作業: 端末のスリープで作業が止まらないよう、スリープを防ぎます(macOS では `caffeinate -i <コマンド>`)。
- 後始末: 作業ツリーの削除(`git worktree remove`)は、版のマージとタグのあとに、最後にまとめて行います。未コミットの変更がないことを確かめてから消します。

## 書いてはいけないもの

コード・ドキュメント・コミット・Issue・PR のすべてで、次を書きません。

- 認証情報(アクセスキー、トークン、パスワードなど)
- 環境固有の値(プロファイル名、アカウント ID、ドメイン、証明書の ARN など)。説明に必要なときは、`example.com` や `<プロファイル名>` のようなプレースホルダーにします。
- 個人情報(氏名、メールアドレス、パスなど)

環境固有の値は、`.env`(gitignore 済み)に置きます。`.env.example` には、プレースホルダーだけを書きます。

## Issue

- 1 つのタスクを 1 件の Issue にします。タイトルは Conventional Commits の形(`feat(scripts): …`、`fix: …` など)にします。
- 版の番号は、Issue の本文に書かず、**マイルストーン**(名前は `vX.Y.Z`)だけで持ちます。本文に「対象バージョン」の行を書きません。本文とマイルストーンの 2 か所で版を持つと、版を振り直すたびに、本文の書き換えと検査と承認が要ります。
- 版が決まっている Issue には、その版のマイルストーンを付けます。版が未定の Issue には、マイルストーンを付けず、ラベル `later` を付けます。
- マイルストーンを新設するときは、説明に、その版の主題と、前の版から何を前提にするかを書きます。
- 起票の前に、似た題の Issue を検索し、候補を人に見せます(`gh issue list --state all --search "<題の語>"`)。「重複」と決めるのは人です。
- 起票・編集は、下書きとマイルストーン・ラベルの一覧(マニフェスト)から、`scripts/post-issues.ts` でまとめて行います(手順: `.claude/skills/dev-pr`)。承認の時点の封印(下書きのハッシュと、一覧の項目 action・number・milestone・labels のハッシュ)を一覧に記録し、投稿の前に一致を確かめます。投稿のあと、番号・題・URL の結果を一覧に書き戻して表示します。途中で失敗しても、投稿済みの行は飛ばして再実行できます。既存の Issue の編集では、ラベルは追加だけで、マイルストーンを付けるときはラベル `later` を外します。
- 受け箱から起票する Issue には、ラベル `lessons` を付けます(`node scripts/lessons.ts draft` が、一覧の項目に入れます。決まりは [docs/lessons-workflow.md](docs/lessons-workflow.md) の「繰り返しと Issue の候補」)。

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
- 再実行してよい作りです。タグ・Release・閉じたマイルストーン・消えたブランチは、「済み」として扱います。失敗した段階(未完了の Issue が残るマイルストーンを含む)で止まり、どの段階まで終えたかを表示します。最後の確認で `Closes` の Issue が閉じていないと表示されたときは、GitHub の反映が遅れていることがあります。時間をおいて、同じコマンドを再実行します。
- Release は、タグの push で `release-tag.yml` が作ります(リリースノートのエントリが本文になります)。スクリプトは、作られるまで待って確かめます。タグとリリースノートは、1 対 1 で対応します。
- スクリプトの呼び出しは、`.claude/settings.json` の確認必須(`ask`)に入っています。権限の確認を省く動作モードでは確認にならないので、人の明示の指示をスキルの中で確かめます。
- 版の締めでは、受け箱に溜めた引っかかりから、同じ種類が繰り返されたものを Issue の候補として提案し、再発を防ぐ形(機械検査、共通の決まり、スキルの手順、`docs/app/lessons/`、`CLAUDE.md`)にします(スキルの Step 4。手順は [docs/lessons-workflow.md](docs/lessons-workflow.md))。

### リポジトリの設定

マージのあと、作業ブランチが残らないように、次の設定にします。

| 設定 | 値 | 確かめ方 |
| --- | --- | --- |
| マージ後にブランチを自動で消す(`delete_branch_on_merge`) | 有効 | `gh api repos/{owner}/{repo} --jq .delete_branch_on_merge` が `true` |
| マージの方式 | マージコミットだけ(`allow_merge_commit` が `true`、`allow_squash_merge` と `allow_rebase_merge` が `false`) | `gh api repos/{owner}/{repo} --jq '{allow_merge_commit, allow_squash_merge, allow_rebase_merge}'` |

設定の変更は、リポジトリの管理者の操作です(`gh api -X PATCH repos/{owner}/{repo} -F delete_branch_on_merge=true -F allow_squash_merge=false -F allow_rebase_merge=false`)。実行の前に、人の確認を取ります。
