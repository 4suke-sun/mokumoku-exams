---
name: dev-pr
description: PR・Issue の起票や編集の前に、タイトルと本文を .drafts/ に下書きし、作成役・検査役の別々のサブエージェントと機械検査で確認し、本文と結果を人に見せて承認を得てから、承認された内容と同一のファイルから投稿する。PR は push も含めて、検査と承認を 1 回にまとめる。PR や Issue を作る・編集するときは、必ずこの手順で行う。
---

# /dev-pr — 漏えいを確認してから PR・Issue を出す

PR・Issue のタイトルと本文は、リモートに残る。編集履歴も、あとから消せない。「出してから直す」は前提にしない。
PR ができると、ブランチの全コミットが参照として保持される。機械検査(`scripts/check-pr-secrets.ts`。Step 2 で手で実行する)は正規表現で
拾えるものを止める。このスキルは、**文脈で判断するもの**を確認する(機械検査との二重防御)。

PR を出すときは、push も含めて、検査を 1 回、人の承認を 1 回にまとめる(範囲の全コミット・作者・ブランチ名と、PR の下書きを、
まとめて検査する)。push は、承認のあとに行う。commit のときに検査した差分は、台帳に記録されていれば、読み直さない
(`scripts/inspection-ledger.ts`)。

## 役割の分け方

| 役 | やること | してはいけないこと |
|---|---|---|
| 作成役(`draft-writer`) | 差分・Issue をもとに、タイトルと本文を `.drafts/` に書く | `.drafts/` 以外の編集、git の書き込み、`gh` の書き込み系、ネットワーク操作、Bash でのファイルの編集(編集は Write ツールだけ) |
| 検査役(別のサブエージェント。`inspector`、必要なら `inspector-deep`) | 下書きと差分を、`checklist.md` に沿って確認し、判定を返す | **一切の書き込み**(読み取り専用) |
| メイン | 各役を起動し、人の承認後に、承認された下書きから投稿する | 承認前の投稿、承認後の下書きの編集 |

作成役と検査役は、別々に起動する(Agent ツール)。検査役は `subagent_type: inspector`(定義は `.claude/agents/`)。
PR・Issue の本文は自由度が高いので、作成役は `commit-writer`(Haiku)ではなく、`draft-writer`(Sonnet)を使う。

## Step 0. 前提の確認

1. PR の場合: PR の範囲(`git log --oneline origin/main..HEAD`)が空でないか。検査と承認は、この範囲の全体に対して行う。
   push は、Step 6 で承認のあとに行う(先に `/dev-push` はしない。push を飛ばす条件も Step 6 に書く)
2. PR の場合: ブランチが `main` でないこと(`git branch --show-current`)。
   `git remote get-url origin` が、意図したリポジトリであること
3. PR の場合: 対応する Issue があるか(ブランチ名が `<prefix>/#<番号>-…` か)
4. 版を切る PR の場合: `data/release-notes.json` に、その版のエントリがあるか
5. タイトルが Conventional Commits か(`feat:` / `fix:` / `chore:` など)

Issue の場合は、さらに次を確かめる(決まりは `CONTRIBUTING.md` の「Issue」):

6. **重複の検索**: 起票の前に、メインのセッションが似た題の Issue を検索し、候補(番号・題・状態・マイルストーン)を人に見せる。
   「重複」と決めるのは人。作成役と検査役は、重複を探さず、決めない:

   ```sh
   gh issue list --state all --search "<題の語>" --limit 20 --json number,title,state,milestone
   ```

7. **版とマイルストーン**: 版の番号は、本文に書かず、マイルストーン(`vX.Y.Z`)だけで持つ。「対象バージョン」の行を書かない。
   版が決まっている Issue にはその版のマイルストーンを、未定の Issue にはマイルストーンなしでラベル `later` を付ける。
   新しいマイルストーンが要るときは、説明に、その版の主題と、前の版から何を前提にするかを書く。

PR と Issue のどちらも、次を確かめる:

8. **同じ記述の洗い出し**: 下書きに仕様・名前・数・振る舞いを書くときは、`/dev-commit` の Step 0 の 5 と同じ語(言い換えや列挙まで広げた検索語を含む)で検索し、
   リポジトリの文書や関係する Issue の記述と食い違わないことを、検査に出す前に確かめる

## Step 1. 作成役: 下書きを書く

下書きの置き場所(gitignore 済み):

- PR: `.drafts/pr-<ブランチ名>.md`(1 行目がタイトル、空行を挟んで本文)。ブランチ名の `/` は `-` に置き換え、`#` は除く(例: `fix/#12-v0.9.0` → `.drafts/pr-fix-12-v0.9.0.md`)
- Issue: 新規は `.drafts/issues/<slug>.md`(番号は投稿まで決まらない)、既存の Issue の編集は `.drafts/issues/<番号>-<slug>.md`。1 行目が `# タイトル`、2 行目が空行、3 行目以降が本文
- 複数の Issue をまとめて起票・編集するときは、一覧(マニフェスト) `.drafts/issues/manifest.json` も書く(メインのセッションが書いてよい)。
  1 行が 1 件で、`action`(`create` / `edit`)、`file`(下書きのファイル名)、編集なら `number`、`milestone`、`labels` を持つ:

  ```json
  [
    { "action": "create", "file": "example.md", "milestone": "v0.99.0", "labels": ["chore"] },
    { "action": "create", "file": "later-example.md", "labels": ["feat", "later"] },
    { "action": "create", "file": "lessons-example-key.md", "milestone": "v0.99.0", "labels": ["lessons"] },
    { "action": "edit", "file": "123-existing.md", "number": 123, "milestone": "v0.99.0" }
  ]
  ```

  受け箱から起票する Issue(`lessons-<キー>.md`)には、ラベル `lessons` を付ける。`node scripts/lessons.ts draft` が、下書きとともに、この項目(マイルストーンなし)を一覧へ足す。
  マイルストーンは、ここで決めて足す(`docs/lessons-workflow.md` の「繰り返しと Issue の候補」)。

作成役に依頼する内容:

- 作業ディレクトリ、対象(PR のブランチ範囲 `origin/main..HEAD`、または Issue の趣旨)
- 「上の形式で下書きを書く。`Closes #<番号>` は番号ごとに 1 行ずつ」
- 材料の渡し方は、`/dev-commit` の Step 2 のとおり(現在の問題と決まりの形で渡す。回数・版・過去の作業の経緯は入れない。設定の値は、値と、値を選んだ理由を分ける)

## Step 2. 機械的な検査

```sh
node scripts/check-pr-secrets.ts <下書きファイル>
```

終了コードが 0 でなければ、指摘を直す(下書きを直し、再度検査する)。

PR の場合は、手元のテストが途中で止まった、または落ちたときは、`npm run test:all` で全件の結果を確かめてから進む(`CONTRIBUTING.md` の「手元の検査(PR の前)」)。

PR の場合は、push 前のフックと同じ検査(範囲内の全コミットの差分・メッセージ・作者)も先に行う:

```sh
printf 'refs/heads/%s %s refs/heads/%s %s\n' "$(git branch --show-current)" "$(git rev-parse HEAD)" "$(git branch --show-current)" 0000000000000000000000000000000000000000 | node scripts/check-push-secrets.ts
```

範囲の作者とコミッターが、GitHub の noreply アドレスか、Claude の署名の行(`Co-Authored-By:`)で使う noreply アドレスであることも確かめる(`git log --format='%h %ae %ce' origin/main..HEAD`。コミッターだけは、GitHub 上のマージが付ける noreply も認める。機械検査と同じ)。

PR の下書きに `Closes` がある場合は、`Closes` の Issue と、マイルストーン・リリースノートの最新の版の対応も確かめる(`gh` で読むだけ。CI の PR でも同じ検査が動く):

```sh
node scripts/check-pr-closes.ts --body-file <下書きファイル>
```

`Closes` の Issue がどれもマイルストーンを持たない PR(Issue 単位の PR・hotfix)は、検査されない。止められたら、`Closes` の Issue、マイルストーン、`data/release-notes.json` の最新の版をそろえる。

## Step 3. 検査役: 確認する

検査役は Bash を持たない。先に、検査役が読む入力を書き出す。PR の場合:

```sh
node scripts/prepare-inspection.ts --pr
```

Issue だけの場合も、拒否リストの置き場を検査役に渡すために実行する(何もステージしていなければ、差分は空で、置き場だけが出る):

```sh
node scripts/prepare-inspection.ts --cached
```

出力の最後の行が、入力のスタンプ(`スタンプ: …`)。入力を書き出し直す前と、片づける前に、走っている検査役がないことを確かめる。

検査役に依頼する内容:

- 作業ディレクトリと、下書きファイルのパス
- 「`.claude/skills/dev-commit/checklist.md` を読み、その項目に沿って、下書きと、PR の場合は `.drafts/inspect/` のファイル
  (基準との差分。検査済みで `covered.txt` に挙げられたコミットの差分は除く。全コミットのメッセージ、ブランチ名)を確認する」
- Step 0 の 8 で検索した語と、食い違いを直さないと決めた箇所(場所と理由)。検査役は、渡された語でリポジトリを検索して確かめてよい
- 作成役の報告の「置いた前提」にある照合の記録(開いた関数・定数、文書と節の名前、確かめた境界の場合。`.claude/skills/dev-commit/writer-rules.md` の「書き方」)。検査役は、記録を読んで、照合の抜けを探す
- 検査の程度(`/dev-commit` の Step 3 の「検査の程度」のとおり。程度ごとの判定の範囲は `inspector-rules.md` の「判定の範囲」。参照先として渡すファイルは、既存で差分の対象ではないと書く。再検査では、前回の指摘の一覧と、直した箇所を添える。`.claude/skills/dev-commit/reconfirm.md` の「再検査の範囲と回数」)
- 「報告は、チェックリストの『報告のしかた(必ず守る)』に従う(値を引用しない。`.drafts/inspect/stamp.txt` のスタンプを書き写す。最後に `判定: OK/WARN/BLOCK`)」

検査役の報告のスタンプが、いまの入力と一致することを確かめる(`node scripts/prepare-inspection.ts --verify <報告のスタンプ>`。`inspector-deep` も使ったときは、報告ごとに、それぞれのスタンプで実行する)。
一致しなければ、止めて、入力を書き出し直して検査をやり直す。確かめたら、書き出したファイルを消す: `node scripts/prepare-inspection.ts --clean`

PR の差分に次のパスが含まれるときは、`inspector-deep`(Sonnet)も別に起動し、`inspector` と**両方**の判定を合わせる
(最も重い判定を採用する)。`scripts/`、`.githooks/`、`.github/workflows/`、`.claude/`。検査の仕組みそのものを変える差分は、
取りこぼしの出方が役ごとに違うため、2 つで補い合う。

入力が分担に分かれたとき(`parts.txt` があるとき)は、`/dev-commit` の Step 3 の「分担」のとおり、分担ごとに検査役を起動し、判定を合わせる。

## Step 4. 判定に応じて動く

| 判定 | 動き |
|---|---|
| `BLOCK` | **出さない。** 指摘(場所と種類)を見せ、直し方を提案する。下書きを直したら、`.claude/skills/dev-commit/reconfirm.md` のとおりやり直す。仕様・名前・数・振る舞いの記述を直したときは、先に Step 0 の 8 の検索をやり直す。ブランチに問題があれば、PR を作る前にコミットを直す |
| `WARN` / `OK` | Step 5 へ |

## Step 5. 人の確認(必須)

次を人に見せて、承認を待つ。

- 下書きの全文(タイトルと本文)
- 差分の要約と、push する範囲のコミット一覧、作者アドレスの確認結果(PR の場合)
- この承認は、push と PR の作成の両方に対するもの(PR の場合)
- 一覧(マニフェスト)から Issue を投稿するときは、一覧の内容(各行の `action`・`number`・`milestone`・`labels`)と、`--dry-run` の出力も見せる(封印は、下書きとこれらの項目を覆う)
- 機械検査と検査役の判定(場所と種類のみ。値は引用しない)

承認の時点で、下書きのハッシュと、PR の場合は範囲の末尾のコミットとコミット数を控える
(再確認の条件は `.claude/skills/dev-commit/reconfirm.md`):

```sh
shasum -a 256 <下書きファイル>
git rev-parse HEAD && git rev-list --count origin/main..HEAD
```

承認の直後に、メインのセッションが承認の印を書く(`.git` の下。有効 60 分。サブエージェントには書かせない。フックが止めるのは、サブエージェントからの `scripts/approval.ts grant` という直接の形だけ)。印がないと、フック(`scripts/approval-hook.ts`)が
push と、`gh pr create`・`gh issue create`、題・本文を変える `gh pr edit`・`gh issue edit` を止める(ラベルやマイルストーンだけの編集は止めない。`post-issues.ts` の中の投稿は、スクリプトの封印が止める)。印は、PR は範囲(ブランチ、末尾のコミット、コミット数)と下書きのハッシュを、
Issue は下書きのハッシュを覆う。`grant pr`・`grant issue` は、下書きの 3 行目以降を `<下書き>.body.md` に書き出し、題と本文のハッシュも印に入れて、置換を使わない投稿のコマンドを表示する:

```sh
node scripts/approval.ts grant pr <下書きファイル>      # PR(push も覆う)
node scripts/approval.ts grant issue <下書きファイル>   # Issue
```

一覧から Issue を投稿するときは(承認の前に見せる `--dry-run` のコマンドは、Step 6)、承認の直後に、一覧へ封印(下書きのハッシュと、一覧の項目 action・number・milestone・labels のハッシュ)を記録する。投稿は、封印と一致する下書きだけを行う:

```sh
node scripts/post-issues.ts .drafts/issues/manifest.json --seal
```

## Step 6. 投稿

1. 投稿の直前に、もう一度ハッシュ(PR の場合は、範囲の末尾のコミットとコミット数も)を取り、Step 5 の値と**一致する**ことを確認する。
   一致しなければ、push も投稿もせず、`.claude/skills/dev-commit/reconfirm.md` のとおりやり直す
2. PR の場合: まず push する(承認済みの範囲)。リモートに同名のブランチがあり、upstream が設定されていて、`git log --oneline @{upstream}..HEAD` が空なら、push は飛ばす(すでに push 済み)。upstream がない、または `@{upstream}` を解決できないときは、push する。`--force` 系は使わない:

   ```sh
   git push -u origin "$(git branch --show-current)"
   ```

3. 下書きのファイルから投稿する(本文を手で打ち直さない。コマンドを組み替えるときは、zsh と BSD 版の道具で動く形にする。`docs/app/lessons/0015-zsh-and-bsd-command-pitfalls.md`):

   ```sh
   # PR(1 行目をタイトル、3 行目以降を本文として扱う)
   gh pr create --base main --title "$(head -n 1 <下書き>)" --body-file <(tail -n +3 <下書き>)
   # Issue(1 行目の「# 」を除いてタイトル、3 行目以降を本文として扱う)
   gh issue create --title "$(head -n 1 <下書き> | sed 's/^# //')" --body-file <(tail -n +3 <下書き>)
   ```

   作業ツリーに入ったセッションは、コマンド置換(`$(…)`)とプロセス置換(`<(…)`)を含む git・gh のコマンドを、実行の前に断る。そのときは、置換を使わない形にする。
   push は、送り先のブランチ名を直書きする(`git push -u origin <ブランチ名>`)。投稿は、`grant` が表示したコマンド(題の直書きと、書き出した本文のファイル)をそのまま使う。
   `gh pr edit`・`gh issue edit` で題・本文を変えるときも、同じ `--title '<題>' --body-file <下書き>.body.md` の形を使う:

   ```sh
   gh pr create --base main --title '<題>' --body-file <下書き>.body.md
   gh issue create --title '<題>' --body-file <下書き>.body.md
   ```

   Issue を一覧(マニフェスト)から投稿するときは、スクリプトを使う。投稿(フラグなし)では、封印(承認の時点のハッシュ)と一致しない下書き、
   題が Conventional Commits の形でない下書き、本文に版の番号の行がある下書き、マイルストーンもラベル `later` もない新規の Issue は、
   投稿せずに止まる:

   ```sh
   node scripts/post-issues.ts .drafts/issues/manifest.json --dry-run   # 検査して、投稿する内容の概要(新規か編集か、ファイル、マイルストーン、ラベル)を表示する(何も投稿しない。封印は求めない。承認の前に見せる)
   node scripts/post-issues.ts .drafts/issues/manifest.json             # 投稿し、結果(番号・題・URL)を一覧に書き戻して表示する
   ```

   投稿の結果の一覧(番号・題・URL)は、人に報告する。一覧は `.drafts/`(gitignore 済み)に残る。

   - 投稿の前に、ラベル(`later` を含む)とマイルストーンが GitHub にあることを確かめる(なければ、`gh label create <名前>`、
     マイルストーンは `gh api repos/{owner}/{repo}/milestones -f title=vX.Y.Z -f description=<主題と前提>` で作る。作成は人の確認を取る)
   - 途中で失敗したときは、投稿済みの行に結果が書き戻されている。原因を直して、同じコマンドを再実行する(投稿済みの行は飛ばす)。
     下書きや一覧の項目を直したときは、検査と承認をやり直し、`--reseal` で封印し直す
   - 既存の Issue の編集では、ラベルは追加だけ。マイルストーンを付けるときは、ラベル `later` を外す

4. `gh pr create` などの前に、承認の印を確かめるフックが動く(`.claude/settings.json`)。印がない、期限が切れた、範囲や下書きが承認のときと違うときは止まる。
   止まったときは、印の書き直しで回避せず、理由を人に伝えて、機械的な検査からやり直す。
   下書きの機械検査(`scripts/check-pr-secrets.ts`)は、Step 2 で承認の前に済ませてある
5. 作ったら、CI の結果を確認する。**最新のコミットの CI が通るまで、マージしない**
6. マージは、このスキルの範囲外(人の指示があるときだけ行う)

コメントやラベルなど、本文の残らない軽い操作は、機械検査のみで足りる(人の確認は省いてよい)。

## 引っかかりの記録

`BLOCK`・`WARN`・差し戻しなど、手戻りが出たときは、その場で受け箱へ足す(`node scripts/lessons.ts add …`。書式と種類のキーは `docs/lessons-workflow.md`)。
同じ種類が繰り返されたものは、版の締めで Issue の候補として提案される。
