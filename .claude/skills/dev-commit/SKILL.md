---
name: dev-commit
description: git commit の前に、ステージした差分とコミットメッセージに、認証情報・環境固有の値・個人情報が混ざっていないかを、機械的な検査と、作成役・検査役の別々のサブエージェントで確認してからコミットする。コミットするときは、必ずこの手順で行う。
---

# /dev-commit — 漏えいを確認してから commit する

履歴に載った値は消しにくい。フック(`.githooks/pre-commit`)は正規表現で拾えるものを止める。
このスキルは、**文脈で判断するもの**を確認する(フックとの二重防御)。

## 役割の分け方

文面を書く側と、確かめる側を、別のサブエージェントにする(Agent ツール、`subagent_type: general-purpose`)。
どちらも、メインのセッションの文脈を引き継がない。

| 役 | やること | してはいけないこと |
|---|---|---|
| 作成役 | 差分を読み、コミットメッセージ案を `.drafts/commit-msg.txt` に書く | `.drafts/` 以外の編集、git の書き込み、ネットワーク操作 |
| 検査役 | 差分とメッセージ案を、`checklist.md` に沿って確認し、判定を返す | **一切の書き込み**(読み取り専用) |
| メイン | 各役を起動し、判定に応じて commit を実行する | 検査役の判定を待たずに commit |

作成役と検査役は、別々に起動する。同じサブエージェントに書かせて確かめさせない。

## Step 0. ステージの確認

1. `git status --short` と `git diff --cached --stat` を見る。**何もステージされていなければ、ここで止める。**
2. ステージは、意図したパスだけを指定して行う。`git add -A` / `git add .` は使わない
3. ブランチが `main` なら、コミットしない(ブランチを切ってから)。ブランチ名は `<prefix>/#<Issue番号>-…`
4. `git config user.email` が、GitHub の noreply アドレス(`…@users.noreply.github.com`)であることを確認する

## Step 1. 機械的な検査

```sh
node scripts/check-commit-secrets.mjs
```

終了コードが 0 でなければ、指摘を直す(pre-commit フックと同じ検査)。通してから Step 2 へ進む。

## Step 2. 作成役: メッセージ案を書く

作成役に依頼する内容:

- 作業ディレクトリ(リポジトリのルート)
- 「`git diff --cached` を読み、[Conventional Commits](https://www.conventionalcommits.org/) 形式のコミットメッセージ案を
  `.drafts/commit-msg.txt` に書く。`Closes #<番号>` は番号ごとに 1 行ずつ。**書いてよいのは `.drafts/commit-msg.txt` だけ**」
- 「`.claude/skills/dev-commit/checklist.md` の『書いてはいけないもの』を守る」

## Step 3. 検査役: 確認する

検査役に依頼する内容:

- 作業ディレクトリ
- 「`.claude/skills/dev-commit/checklist.md` を読み、その項目に沿って、`git diff --cached` の差分と
  `.drafts/commit-msg.txt` を確認する」
- 「**読み取り専用**。編集、`git add` / `commit` / `push`、ネットワーク操作はしない」
- 「`.pr-secrets-denylist` があれば読み、その語が差分にないかも確認する。**語そのものは報告に書かない**」
- 「報告は、チェックリストの『報告のしかた』に従う(値を引用しない。最後に `判定: OK/WARN/BLOCK`)」

差分が大きい場合は、検査役を複数に分けてよい。最も重い判定を採用する。読み切れなかったと報告されたら、
`OK` とみなさない。

## Step 4. 判定に応じて動く

| 判定 | 動き |
|---|---|
| `BLOCK` | **コミットしない。** 指摘(場所と種類)を人に見せ、直し方を提案する。直したら Step 1 からやり直す |
| `WARN` | 指摘を人に見せ、コミットしてよいか聞く |
| `OK` | Step 5 へ(人の確認は要らない) |

## Step 5. コミット

```sh
git commit -F .drafts/commit-msg.txt
```

- メッセージの末尾には、セッションで指示された署名の行を付ける(作成役の案に無ければ、ここで足す。足したら、
  追加分は定型の署名だけなので、再検査は要らない)
- コミット後、`git log -1 --format='%an <%ae>'` で、作者が noreply アドレスであることを確認する。違えば、
  `git config user.email` を直して `git commit --amend --reset-author`(push 前のローカルのみ)
- `git commit --no-verify` は使わない。フックが止めたら、指摘を直す
