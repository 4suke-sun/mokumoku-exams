---
name: dev-push
description: git push の前に、push する範囲の全コミット・ブランチ名・作者情報に、認証情報・環境固有の値・個人情報・意図しない作者のメールアドレスが混ざっていないかを、機械的な検査と検査役のサブエージェントで確認し、結果を人に見せて承認を得てから push する。push するときは、必ずこの手順で行う。
---

# /dev-push — 漏えいを確認してから push する

push すると、その範囲の**履歴すべて**がリモートに載る。最後のコミットだけでなく、途中のコミットも見る
(あとで消した値も、途中のコミットには残っている)。フック(`.githooks/pre-push`)は正規表現で拾えるものを
止める。このスキルは、**文脈で判断するもの**と**作者情報**を確認する(フックとの二重防御)。

PR も出すときは、このスキルではなく `/dev-pr` を使う(push も含めて、検査と承認が 1 回になる)。
commit のときに検査した差分は、台帳に記録されていれば読み直さない(`scripts/inspection-ledger.ts`)。

検査は、検査役のサブエージェント(Agent ツール、`subagent_type: inspector`。定義は `.claude/agents/`)が行う。コミットを作った
セッションとは別の、文脈を引き継がない目で見る。**push は、検査が OK でも、人が結果を見て承認するまで行わない。**

## Step 0. 範囲と作者情報の確認

1. `git branch --show-current` でブランチを確認する。`main` への直接 push は、リリースタグの運用に従う
   ときだけで、通常はしない
2. push する範囲を決める: `git log --oneline origin/main..HEAD`(新規ブランチ)、
   既存ブランチなら `git log --oneline @{upstream}..HEAD`。**空なら、ここで止める**(push するものがない。
   `/dev-pr` は、このスキルを使わず、push を飛ばす条件を Step 6 で別に判断する。PR の作成が残っているので、push だけを飛ばして先へ進む)
3. 範囲の全コミットの作者とコミッターが、GitHub の noreply アドレスか、Claude の署名の行(`Co-Authored-By:`)で使う noreply アドレスであることを確認する:
   ```sh
   git log --format='%h %ae %ce' origin/main..HEAD
   ```
   `…@users.noreply.github.com` と Claude の署名用の noreply 以外があれば、**止めて報告する**(コミッターだけは、GitHub 上のマージが付ける noreply も認める。機械検査と同じ)
4. `git remote get-url origin` が、意図したリポジトリであることを確認する

## Step 1. 機械的な検査

pre-push フックと同じ検査を、先に実行する。標準入力は `<ローカルref> <ローカルSHA> <リモートref> <リモートSHA>`
の形式。新規ブランチのリモート SHA は 40 桁の 0:

```sh
printf 'refs/heads/%s %s refs/heads/%s %s\n' "$(git branch --show-current)" "$(git rev-parse HEAD)" "$(git branch --show-current)" 0000000000000000000000000000000000000000 | node scripts/check-push-secrets.ts
```

終了コードが 0 でなければ、指摘を直す。

## Step 2. 検査役: 確認する

検査役は Bash を持たない。先に、検査役が読む入力を書き出す(範囲は Step 0 で決めたもの):

```sh
node scripts/prepare-inspection.ts --range <Step 0 で決めた範囲>
```

検査役に依頼する内容:

- 作業ディレクトリ
- 「`.claude/skills/dev-commit/checklist.md` を読み、その項目に沿って、`.drafts/inspect/` のファイル
  (範囲の全コミットの差分。検査済みで `covered.txt` に挙げられたコミットの差分は除く。**コミットメッセージ、ブランチ名**)を確認する。最後のコミットだけで済ませない」
- 「報告は、チェックリストの『報告のしかた(必ず守る)』に従う(値を引用しない。最後に `判定: OK/WARN/BLOCK`)」

検査が終わったら、書き出したファイルを消す: `node scripts/prepare-inspection.ts --clean`

範囲の差分に次のパスが含まれるときは、`inspector-deep`(Sonnet)も別に起動し、`inspector` と**両方**の判定を合わせる
(最も重い判定を採用する)。`scripts/`、`.githooks/`、`.github/workflows/`、`.claude/`。検査の仕組みそのものを変える差分は、
取りこぼしの出方が役ごとに違うため、2 つで補い合う。

コミットが多い、または差分が大きいときは、範囲やディレクトリごとに複数に分ける。最も重い判定を採用する。
読み切れなかったと報告されたら、`OK` とみなさない。

## Step 3. 判定に応じて動く

| 判定 | 動き |
|---|---|
| `BLOCK` | **push しない。** 指摘(場所と種類、どのコミットか)を見せ、直し方を提案する。まだ push していないので、コミットを作り直せる(`git reset --soft` で戻して、直して、コミットし直す)。直したら、`.claude/skills/dev-commit/reconfirm.md` のとおりやり直す |
| `WARN` / `OK` | Step 4 へ |

## Step 4. 人の確認(必須)

次を人に見せて、承認を待つ。

- push する範囲のコミット一覧と、差分の要約(ファイル単位)
- 作者アドレスの確認結果
- 機械検査と検査役の判定(場所と種類のみ。値は引用しない)

承認が出るまで、push しない。承認の時点で、範囲の末尾のコミットとコミット数を控え、push の直前にもう一度取って比べる。
承認後の再確認は、`.claude/skills/dev-commit/reconfirm.md` に従う。

## Step 5. push

push の直前に、範囲の末尾のコミットとコミット数をもう一度取り、Step 4 の承認の時点と一致することを確かめる(`.claude/skills/dev-commit/reconfirm.md`)。

```sh
git push -u origin "$(git branch --show-current)"
```

- `--force` / `--force-with-lease` は、このスキルでは実行しない。必要なら、理由を説明して人の承認を待つ
- push が失敗したら、原因を確認してから、1 回だけ再試行する
- PR も出すなら、push の前に `/dev-pr` を使う(push も含めて、検査と承認が 1 回になる)。このスキルで先に push したあとに PR だけ出すときも、`/dev-pr` を使う

## 引っかかりの記録

`BLOCK`・`WARN`・差し戻しなど、手戻りが出たときは、その場で受け箱へ足す(`node scripts/lessons.ts add …`。書式と種類のキーは `docs/lessons-workflow.md`)。
同じ種類が繰り返されたものは、版の締めで Issue の候補として提案される。
