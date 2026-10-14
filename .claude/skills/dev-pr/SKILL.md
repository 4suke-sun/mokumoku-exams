---
name: dev-pr
description: PR・Issue の起票や編集の前に、タイトルと本文を .drafts/ に下書きし、作成役・検査役の別々のサブエージェントと機械検査で確認し、本文と結果を人に見せて承認を得てから、承認された内容と同一のファイルから投稿する。PR や Issue を作る・編集するときは、必ずこの手順で行う。
---

# /dev-pr — 漏えいを確認してから PR・Issue を出す

PR・Issue のタイトルと本文は、リモートに残る。編集履歴も、あとから消せない。「出してから直す」は前提にしない。
PR ができると、ブランチの全コミットが参照として保持される。フック(`scripts/check-pr-secrets.ts`)は正規表現で
拾えるものを止める。このスキルは、**文脈で判断するもの**を確認する(フックとの二重防御)。

## 役割の分け方

| 役 | やること | してはいけないこと |
|---|---|---|
| 作成役(`draft-writer`) | 差分・Issue をもとに、タイトルと本文を `.drafts/` に書く | `.drafts/` 以外の編集、git の書き込み、`gh` の書き込み系、ネットワーク操作 |
| 検査役(別のサブエージェント。`inspector`、必要なら `inspector-deep`) | 下書きと差分を、`checklist.md` に沿って確認し、判定を返す | **一切の書き込み**(読み取り専用) |
| メイン | 各役を起動し、人の承認後に、承認された下書きから投稿する | 承認前の投稿、承認後の下書きの編集 |

作成役と検査役は、別々に起動する(Agent ツール)。検査役は `subagent_type: inspector`(定義は `.claude/agents/`)。
PR・Issue の本文は自由度が高いので、作成役は `commit-writer`(Haiku)ではなく、`draft-writer`(Sonnet)を使う。

## Step 0. 前提の確認

1. PR の場合: ブランチが push 済みか(`git status -sb`)。未 push なら、先に `/dev-push`
2. PR の場合: 対応する Issue があるか(ブランチ名が `<prefix>/#<番号>-…` か)
3. 版を切る PR の場合: `data/release-notes.json` に、その版のエントリがあるか
4. タイトルが Conventional Commits か(`feat:` / `fix:` / `chore:` など)

## Step 1. 作成役: 下書きを書く

下書きの置き場所(gitignore 済み):

- PR: `.drafts/pr-<ブランチ名>.md`(1 行目がタイトル、空行を挟んで本文)
- Issue: `.drafts/issues/<番号>-<slug>.md`(1 行目が `# タイトル`)

作成役に依頼する内容:

- 作業ディレクトリ、対象(PR のブランチ範囲 `origin/main..HEAD`、または Issue の趣旨)
- 「上の形式で下書きを書く。`Closes #<番号>` は番号ごとに 1 行ずつ」

## Step 2. 機械的な検査

```sh
node scripts/check-pr-secrets.ts <下書きファイル>
```

終了コードが 0 でなければ、指摘を直す(下書きを直し、再度検査する)。

## Step 3. 検査役: 確認する

検査役は Bash を持たない。先に、検査役が読む入力を書き出す(PR の場合。Issue だけのときは不要):

```sh
node scripts/prepare-inspection.ts --pr
```

検査役に依頼する内容:

- 作業ディレクトリと、下書きファイルのパス
- 「`.claude/skills/dev-commit/checklist.md` を読み、その項目に沿って、下書きと、PR の場合は `.drafts/inspect/` のファイル
  (基準との全差分・全コミットメッセージ・ブランチ名)を確認する」
- 「報告は、チェックリストの『報告のしかた(必ず守る)』に従う(値を引用しない。最後に `判定: OK/WARN/BLOCK`)」

検査が終わったら、書き出したファイルを消す: `node scripts/prepare-inspection.ts --clean`

PR の差分に次のパスが含まれるときは、`inspector-deep`(Sonnet)も別に起動し、`inspector` と**両方**の判定を合わせる
(最も重い判定を採用する)。`scripts/`、`.githooks/`、`.github/workflows/`、`.claude/`。検査の仕組みそのものを変える差分は、
取りこぼしの出方が役ごとに違うため、2 つで補い合う。

差分が大きいときは、ディレクトリごとに複数に分ける。最も重い判定を採用する。読み切れなかったと報告されたら、
`OK` とみなさない。

## Step 4. 判定に応じて動く

| 判定 | 動き |
|---|---|
| `BLOCK` | **出さない。** 指摘(場所と種類)を見せ、直し方を提案する。下書きを直したら、`.claude/skills/dev-commit/reconfirm.md` のとおりやり直す。ブランチに問題があれば、PR を作る前にコミットを直す |
| `WARN` / `OK` | Step 5 へ |

## Step 5. 人の確認(必須)

次を人に見せて、承認を待つ。

- 下書きの全文(タイトルと本文)
- 差分の要約(PR の場合)
- 機械検査と検査役の判定(場所と種類のみ。値は引用しない)

承認の時点で、下書きのハッシュを控える(再確認の条件は `.claude/skills/dev-commit/reconfirm.md`):

```sh
shasum -a 256 <下書きファイル>
```

## Step 6. 投稿

1. 投稿の直前に、もう一度ハッシュを取り、Step 5 の値と**一致する**ことを確認する。一致しなければ、
   投稿せず、`.claude/skills/dev-commit/reconfirm.md` のとおりやり直す
2. 下書きのファイルから投稿する(本文を手で打ち直さない):

   ```sh
   # PR(1 行目をタイトル、3 行目以降を本文として扱う)
   gh pr create --base main --title "$(head -n 1 <下書き>)" --body-file <(tail -n +3 <下書き>)
   # Issue(1 行目の「# 」を除いてタイトル、3 行目以降を本文として扱う)
   gh issue create --title "$(head -n 1 <下書き> | sed 's/^# //')" --body-file <(tail -n +3 <下書き>)
   ```

3. `gh pr create` の前には、フック(`scripts/check-pr-secrets.ts`)も動く。止められたら、指摘を直す
4. 作ったら、CI の結果を確認する。**最新のコミットの CI が通るまで、マージしない**
5. マージは、このスキルの範囲外(人の指示があるときだけ行う)

コメントやラベルなど、本文の残らない軽い操作は、機械検査のみで足りる(人の確認は省いてよい)。
