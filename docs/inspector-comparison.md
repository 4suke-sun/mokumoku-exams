# 検査役の見比べ(inspector と inspector-deep)

`inspector`(Haiku)と `inspector-deep`(Sonnet)を、同じ入力で別々に流し、拾えた指摘・見落とし・誤検出・読んだトークン・時間を比べる手順と、記録の表です。
`inspector-deep` を `inspector` に一本化するかを、この結果を見てから人が決めます(#519 の「決めること」(b))。

課題は [lessons-regression.md](lessons-regression.md) の R26〜R36、入力は [regression-inputs/](regression-inputs/) にあります。
起動するのはメインのセッションで、課題ごとに 2 つの役を起動します。結果は、件数と種類だけを Issue のコメントに残し、リポジトリには残しません(`lessons-regression.md` の「流し方」)。

## 準備

1. 使い捨ての作業ツリーを作る。本物のブランチ・Issue・PR には出さない。

   ```sh
   git worktree add <親ディレクトリ>/wt-inspector-compare -b chore/#519-inspector-compare origin/main
   ```

   依存は、`CONTRIBUTING.md` の「並行する作業(作業ツリー)」のとおりに用意する。
2. 入力の置き場を、作業ツリーの外(セッションの一時の置き場など)に写す。以下、写した先を `<入力>` と書く。
3. 答えが検査役の目に入らないよう、作業ツリーから、課題の文書と入力の置き場を消す。消した変更はステージしない(ステージした差分だけが検査の入力になる。`node scripts/prepare-inspection.ts --cached`)。

   ```sh
   rm -r docs/regression-inputs docs/lessons-regression.md docs/inspector-comparison.md
   ```

4. 拒否リストが、主の作業ツリーの直下にあることを確かめる(`CONTRIBUTING.md` の「拒否リスト」)。

## 課題ごとの流し方

課題ごとに、次を 1 回ずつ行う。課題の順は問わない。

1. 入力を当てる。
   - 差分: `git apply <入力>/rNN.patch` のあと `git add` で足したファイルをステージする。
   - R29: 差分のほかに、`<入力>/r29-release-entry.json` の `version` を、そのときの最新の版の次のパッチの版に、`date` を当日に直し、`data/release-notes.json` の `releases` の先頭に足してステージする。
   - R30: 差分は当てない。`<入力>/r30-issue-draft.md` を `.drafts/issues/r30-issue-draft.md` に写す(`/dev-pr` の Issue の下書きの置き場と形)。
   - R31: `r31-base.patch` を当ててステージしない。`r31.patch` を当て、そのファイルだけをステージする。
   - R36: `r36.patch` を当てたあと、文書の 2 つの印を置き換えてからステージする。値は手で打たず、次のように組み立てる(値は会話にも記録にも書かない)。

     ```sh
     node -e 'const fs=require("node:fs");const f="docs/app/cost-check.md";const n=String(Date.now()).slice(0,12);const p=["","Users","u"+Math.random().toString(36).slice(2,8),"work"].join("/");fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace("ACCOUNT_MARKER",n).replace("PATH_MARKER",p))'
     ```

   - メッセージ案があれば、`<入力>/rNN-commit-msg.txt` を `.drafts/commit-msg.txt` に写す。
2. 入力を書き出す: `node scripts/prepare-inspection.ts --cached`。出たスタンプを控える。
3. `inspector` と `inspector-deep` を、同じ依頼の文面で、同時に起動する(下の「依頼の文面」)。依頼には、課題の番号・期待・この文書の名前を書かない。
4. 2 つの報告のスタンプを、それぞれ `node scripts/prepare-inspection.ts --verify <スタンプ>` で確かめる。違えば、その報告は記録せず、流し直す。
5. 完了の通知に出るトークンと所要時間を、役ごとに控える(`npm run metrics -- agent <役> <ミリ秒> <トークン>` でも足す)。
6. 報告を、課題の「期待」と照らし、下の「数え方」で記録の表に書く。
7. 片づける: `node scripts/prepare-inspection.ts --clean`、`git reset -q`、`git apply -R <入力>/rNN.patch`(R31 は `r31.patch` と `r31-base.patch` の両方。R36 は印を置き換えて内容が変わるので、`git apply -R` ではなく、パッチが足した `docs/app/cost-check.md` を消す)、R29 は `git checkout -- data/release-notes.json`、`.drafts/` に写したファイルを消す。
   `git status --short` で、手順 3 で消した 3 つのほかに変更が残っていないことを確かめる。

### 依頼の文面

2 つの役に、同じ文面を渡す。`/dev-commit` の Step 3(R30 は `/dev-pr` の Issue の検査)の依頼の型に合わせる。

- 作業ディレクトリ(使い捨ての作業ツリー)
- 「`.claude/skills/dev-commit/checklist.md` を読み、その項目に沿って、`.drafts/inspect/` のファイルと、`.drafts/commit-msg.txt`(R30 は `.drafts/issues/r30-issue-draft.md`)を確認する」
- 「`.drafts/inspect/denylist.txt` に挙がった拒否リストの置き場は、作業ツリーの外のものも含めて、すべて読む。1 つでも読めないときは、判定を `OK` にしない」
- 検索した語: なし。照合の記録: なし(どの課題も同じにする)
- 検査の程度: `medium`
- 「報告は、チェックリストの『報告のしかた(必ず守る)』に従う(値を引用しない。`.drafts/inspect/stamp.txt` のスタンプを書き写す。最後に `判定: OK/WARN/BLOCK`)」

### 数え方

- **拾えた**: 課題の「期待」の指摘(場所と種類)が、`判定:` の理由として報告にある。R30 は 4 か所中の数で書く。
- **見落とし**: 「期待」の指摘が報告にない。`参考:` の欄にだけ出たものも、見落としに数える(判定に効かないため)。
- **誤検出**: `WARN` 以上の理由のうち、「期待」になく、定義元を開いても食い違いでないもの。R34・R35 は、`WARN` 以上の指摘がすべて誤検出。
- **ほかの正当な指摘**: 「期待」にないが、定義元を開くと実際に食い違っているもの。誤検出に数えず、別に書く(課題の見本の直しの候補にする)。
- **判定**: 報告の `判定:` の行。期待と違えば、表で目立つように書く。

拾えたか、誤検出かで迷う指摘は、メインが決めず、表の備考に場所と種類を書いて人に見せる。

## 記録の表

1 回の流しにつき 1 つの表を作り、Issue のコメントに貼る。値・本文・パスは書かず、件数と種類だけを書く。

| 課題 | 期待 | 役 | 判定 | 拾えた | 見落とし | 誤検出 | ほかの正当な指摘 | トークン | 時間(秒) | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R26 | WARN | inspector | | | | | | | | |
| R26 | WARN | inspector-deep | | | | | | | | |
| R27 | WARN | inspector | | | | | | | | |
| R27 | WARN | inspector-deep | | | | | | | | |
| R28 | WARN | inspector | | | | | | | | |
| R28 | WARN | inspector-deep | | | | | | | | |
| R29 | WARN | inspector | | | | | | | | |
| R29 | WARN | inspector-deep | | | | | | | | |
| R30 | WARN | inspector | | /4 | | | | | | |
| R30 | WARN | inspector-deep | | /4 | | | | | | |
| R31 | WARN | inspector | | | | | | | | |
| R31 | WARN | inspector-deep | | | | | | | | |
| R32 | WARN | inspector | | | | | | | | |
| R32 | WARN | inspector-deep | | | | | | | | |
| R33 | WARN | inspector | | | | | | | | |
| R33 | WARN | inspector-deep | | | | | | | | |
| R34 | OK | inspector | | — | — | | | | | |
| R34 | OK | inspector-deep | | — | — | | | | | |
| R35 | OK | inspector | | — | — | | | | | |
| R35 | OK | inspector-deep | | — | — | | | | | |
| R36 | BLOCK | inspector | | /2 | | | | | | |
| R36 | BLOCK | inspector-deep | | /2 | | | | | | |

表の下に、役ごとの合計を書く。

| 役 | 判定が期待どおりの課題 | 拾えた(合計) | 見落とし(合計) | 誤検出(合計) | トークン(合計) | 時間(合計) | 費用(見積もり) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| inspector | /11 | | | | | | |
| inspector-deep | /11 | | | | | | |

費用は、流した日を区切って `npm run agent-cost -- --since <日付> --until <日付>` の役ごとの行から写す(同じ日にほかの作業で検査役を使ったときは、その件数を備考に書く)。

あわせて、課題を「検査の仕組みの差分」を含むもの(R26・R27・R29・R31・R32・R33・R35)と、含まないもの(R28・R30・R34・R36)に分け、
`inspector` だけが見落とし `inspector-deep` が拾えた課題の数を、それぞれ書く。決めること (b) の材料はこの数である。

## 判断の材料(決めるのは人)

#519 の「決めること」(b) の推奨は、`inspector-deep` だけが `WARN`・`BLOCK` を出した例を数えてから決める、である。
この見比べの結果に、台帳の判定の内訳(`npm run metrics`)と、受け箱の記録(`inspector-deep` の指摘で記録された種類)を並べて、人に見せる。
どの案を採るかの目安は、人が結果を見てから決める。この文書には書かない。
