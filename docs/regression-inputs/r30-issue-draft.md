# chore(scripts): 受け箱の読み込みの検査と、作成役の Bash の判定の説明をそろえる

## 目的

受け箱の読み込みと、サブエージェントの Bash の判定について、文書の説明と実装の振る舞いをそろえる。

## 今の振る舞い

- 受け箱の読み込みは、版の形が不正な行を読み込み、警告を出す。テストの「版の形が不正な行_読み込んで警告を出す」が、この振る舞いを確かめている(`scripts/lib/lessons-inbox.test.ts`)。
- サブエージェントの Bash の判定(`scripts/lib/subagent-command.ts`)は、作成役(`commit-writer`・`draft-writer`)に加えて、検査役(`inspector`)の Bash も止める。
- `commit-writer` が Bash で実行してよいコマンドは、`git diff`・`git log`・`git show`・`git status`・`git rev-parse`・`cat` である。
- 回帰の課題の流し方は、`docs/lessons-workflow.md` の「回帰の流し方」に書かれている。

## 作業

- 上の振る舞いを、`docs/lessons-workflow.md` と `CONTRIBUTING.md` の説明に写す。
- 説明と実装の食い違いを、テストの題とあわせて見直す。

## 完了条件

- 文書の説明が、実装とテストの振る舞いと一致している。
