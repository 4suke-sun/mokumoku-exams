---
name: dev-commit
description: git commit の前に、ステージした差分とコミットメッセージに、認証情報・環境固有の値・個人情報が混ざっていないかを、機械的な検査と、作成役・検査役の別々のサブエージェントで確認してからコミットする。コミットするときは、必ずこの手順で行う。
---

# /dev-commit — 漏えいを確認してから commit する

履歴に載った値は消しにくい。フック(`.githooks/pre-commit`)は正規表現で拾えるものを止める。
このスキルは、**文脈で判断するもの**を確認する(フックとの二重防御)。

## 役割の分け方

文面を書く側と、確かめる側を、別のサブエージェントにする(Agent ツール)。定義は `.claude/agents/` にあり、
どちらも、メインのセッションの文脈を引き継がない。使うモデルの理由は ADR 0003 を参照。

| 役 | やること | してはいけないこと |
|---|---|---|
| 作成役(`commit-writer`) | 差分を読み、コミットメッセージ案を `.drafts/commit-msg.txt` に書く | `.drafts/` 以外の編集、git の書き込み、ネットワーク操作 |
| 検査役(`inspector`、必要なら `inspector-deep`) | 差分とメッセージ案を、`checklist.md` に沿って確認し、判定を返す | **一切の書き込み**(読み取り専用) |
| メイン | 各役を起動し、判定に応じて commit を実行する | 検査役の判定を待たずに commit |

作成役と検査役は、別々に起動する。同じサブエージェントに書かせて確かめさせない。

## Step 0. ステージの確認と、同じ記述の洗い出し

1. `git status --short` と `git diff --cached --stat` を見る。**何もステージされていなければ、ここで止める。**
2. ステージは、意図したパスだけを指定して行う。`git add -A` / `git add .` は使わない
3. ブランチが `main` なら、コミットしない(ブランチを切ってから)。ブランチ名は `<prefix>/#<Issue番号>-…`
4. `git config user.email` が、GitHub の noreply アドレス(`…@users.noreply.github.com`)か、Claude の署名の行(`Co-Authored-By:`)で使う noreply アドレスであることを確認する
5. 仕様・名前・数・振る舞いを変える差分では、検査に出す前に、同じことを書いている箇所を洗い出して、同じ差分でまとめて直す。
   変えた語(関数・設定・項目の名前、理由コード、画面の文言、旧い前提を表す語)で、リポジトリの全体を検索する(`git grep --untracked`。未追跡の新しいファイルも含める。
   文書、`CLAUDE.md`、スキルとエージェントの定義、コードとコメント、画面の文言、`data/` のヘルプの本文などを含む)。
   検索した語と、直さないと決めた箇所の理由は、検査役への依頼に書く。
   検査で 1 か所を指摘されたときも、同じ語で検索し直して、残りをまとめて直してから再検査に出す

## Step 1. 機械的な検査

```sh
node scripts/check-commit-secrets.ts
```

終了コードが 0 でなければ、指摘を直す(pre-commit フックと同じ検査)。通してから Step 2 へ進む。

## Step 2. 作成役: メッセージ案を書く

作成役(`subagent_type: commit-writer`)に依頼する内容:

- 作業ディレクトリ(リポジトリのルート)
- 「`git diff --cached` を読み、[Conventional Commits](https://www.conventionalcommits.org/) 形式のコミットメッセージ案を
  `.drafts/commit-msg.txt` に書く。`Closes #<番号>` は番号ごとに 1 行ずつ」

## Step 3. 検査役: 確認する

検査役に依頼する前に、ステージした差分とメッセージ案のハッシュを控える(`.claude/skills/dev-commit/reconfirm.md`)。

検査役は Bash を持たない。先に、検査役が読む入力を書き出す:

```sh
node scripts/prepare-inspection.ts --cached
```

検査役(`subagent_type: inspector`)に依頼する内容:

- 作業ディレクトリ
- 「`.claude/skills/dev-commit/checklist.md` を読み、その項目に沿って、`.drafts/inspect/` のファイルと
  `.drafts/commit-msg.txt` を確認する」
- Step 0 の 5 で検索した語と、直さないと決めた箇所(場所と理由)。検査役は、渡された語でリポジトリを検索して確かめてよい
- 「報告は、チェックリストの『報告のしかた(必ず守る)』に従う(値を引用しない。最後に `判定: OK/WARN/BLOCK`)」

検査が終わったら、書き出したファイルを消す: `node scripts/prepare-inspection.ts --clean`

差分に次のパスが含まれるときは、`inspector-deep`(Sonnet)も別に起動し、`inspector` と**両方**の判定を合わせる
(最も重い判定を採用する)。`scripts/`、`.githooks/`、`.github/workflows/`、`.claude/`。検査の仕組みそのものを変える差分は、
取りこぼしの出方が役ごとに違うため、2 つで補い合う。

差分が大きい場合は、検査役を複数に分けてよい。最も重い判定を採用する。読み切れなかったと報告されたら、
`OK` とみなさない。

## Step 4. 判定に応じて動く

| 判定 | 動き |
|---|---|
| `BLOCK` | **コミットしない。** 指摘(場所と種類)を人に見せ、直し方を提案する。直したら(メッセージ案だけなら、案を直接直す)、`.claude/skills/dev-commit/reconfirm.md` のとおり Step 1 からやり直す。差分を直したときは、先に Step 0 の 5 の検索をやり直す |
| `WARN` | 指摘を人に見せ、コミットしてよいか聞く |
| `OK` | Step 5 へ(人の確認は要らない) |

## Step 5. コミット

commit の直前に、差分とメッセージ案のハッシュをもう一度取り、検査のときと一致することを確かめる。

```sh
git commit -F .drafts/commit-msg.txt
```

- メッセージの末尾には、`Co-Authored-By:` の署名の行を付けてよい。作成役の案に無ければ、ここで足す。
  足すだけなら、`.claude/skills/dev-commit/reconfirm.md` の例外のとおり、再検査は要らない。
  Claude のセッションへのリンク(`Claude-Session:` の行など)は付けない。機械検査が止める
- コミット後、検査した差分を台帳に記録する。種類は、実施した検査(`mechanical`、`inspector`、`inspector-deep`)をコンマでつなぎ、
  判定は、合わせた判定(`OK` / `WARN`)を渡す。push と PR の検査で、台帳に一致する差分は読み直されない
  (判定が `WARN` のものは、読み直される):

  ```sh
  node scripts/inspection-ledger.ts record HEAD mechanical,inspector OK
  ```

- コミット後、`git log -1 --format='%an <%ae>'` で、作者が Step 0 の 4 の noreply アドレスであることを確認する。違えば、
  `git config user.email` を直して `git commit --amend --reset-author`(push 前のローカルのみ)
- `git commit --no-verify` は使わない。フックが止めたら、指摘を直す

## 引っかかりの記録

`BLOCK`・`WARN`・差し戻しなど、手戻りが出たときは、その場で受け箱へ足す(`node scripts/lessons.ts add …`。書式と種類のキーは `docs/lessons-workflow.md`)。
同じ種類が繰り返されたものは、版の締めで Issue の候補として提案される。
