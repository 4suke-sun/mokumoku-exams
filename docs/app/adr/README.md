# 設計判断の記録(ADR)

あとから、判断の理由をたどれるようにするための記録です。1 つの判断につき 1 ファイルで書きます。

## 置き場と番号

- 置き場は `docs/app/adr/` です。
- ファイル名は `NNNN-<短い英語の説明>.md`(例: `0001-language-and-tooling.md`)。番号は 4 桁の連番で、欠番を詰めません。
- テンプレートは [0000-template.md](./0000-template.md) です。コピーして、番号と題を変えます。

## 状態

| 状態 | 意味 |
| --- | --- |
| 提案中 | 検討中 |
| 採用 | 現在の方針 |
| 置き換え済み | 新しい ADR に置き換えられた(置き換えた ADR の番号を書く) |

## 書き方

- 「どう決めたか」と「なぜか」を、現在形の一般的な書き方で書きます。経緯を語る書き方にしません。
- 採用しなかった選択肢と、その理由も書きます。
- 判断を変えるときは、元の ADR を書き換えず、新しい ADR を追加して、元の状態を「置き換え済み」にします。
- 環境固有の値、個人情報、認証情報は書きません。

## 一覧

- [0001 言語とツールの統一(TypeScript、Biome、Vitest)](./0001-language-and-tooling.md)
- [0002 データの検証に Zod を使う](./0002-schema-validation-zod.md)
- [0003 作成役と検査役のモデルを使い分ける](./0003-model-split-for-agents.md)
- [0004 アプリは問題データの型を、スキーマから型だけ参照する](./0004-app-shares-data-types-by-type-import.md)
- [0005 作問パイプラインを同じリポジトリの 3 つ目のワークスペースに置き、境界を守る](./0005-pipeline-workspace-and-boundary.md)
- [0006 一次情報は、リンクと言い換えだけを台帳に持つ](./0006-source-ledger-and-rights.md)
- [0007 作問を段階に分け、段階ごとに関門を置く](./0007-stages-and-gates.md)
- [0008 問題の来歴を台帳で結び、公開データの正は `data/` に置く](./0008-provenance-and-data-source-of-truth.md)
- [0009 モデルを使う段階は、Claude Code のエージェントで実行する](./0009-execution-via-claude-code-agents.md)
- [0010 pipeline の版はアプリと同じ版で運用し、切り出しは v1.0.0 以降に判断する](./0010-pipeline-versioning-and-extraction.md)
- [0011 データの契約を共有パッケージ(`packages/data-schema`)に置く](./0011-data-contract-shared-package.md)
- [0012 パイプラインで作る問題は、公開済みの問題に足す](./0012-pipeline-adds-to-published-questions.md)
- [0013 解説は下書きの段階で書き、別の段階を持たない](./0013-explanation-in-draft-stage.md)
- [0014 書き出しは作業ツリーの `data/` に書き、人が PR の差分で確かめる](./0014-export-writes-working-tree-data.md)
- [0015 作問パイプラインの役のモデルを表で固定し、検証役は下書きの役と別のモデルにする](./0015-pipeline-agent-roles-and-models.md)
- [0016 作問パイプラインの役のモデルの表に、出典の候補を挙げる役を足す](./0016-pipeline-source-scout-role.md)
- [0017 事実カードの台帳には、アンカーの引用を残さない](./0017-fact-ledger-without-anchor-quotes.md)
- [0018 試験ガイドの対象サービスの一覧を事実として持ち、事実カードの選び方でサービスの目標に寄せる](./0018-exam-guide-service-list-and-targets.md)
- [0019 作問パイプラインの役のモデルの表に、保留の下書きを直す役を足す](./0019-pipeline-reviser-role.md)
- [0020 書き出しは、出典の URL と公式ページの題を公開データに載せる](./0020-export-references-with-titles.md)
- [0021 作問パイプラインの役のモデルの表に、公開の問題の質を判定する役を足す](./0021-pipeline-judge-role.md)
- [0022 非公開の問題は、アプリが読まない別のファイルに持つ](./0022-unpublished-questions-in-separate-file.md)
- [0023 非公開の問題の書き直しは、パイプラインが扱い、元の ID のまま公開へ戻す](./0023-rewrite-unpublished-questions.md)
- [0024 試験ガイドの対象サービス・対象外サービスの一覧で、問題の範囲を検査する](./0024-scope-check-by-exam-guide-service-lists.md)
- [0025 出典の変更の検出を、見える本文のハッシュで行う](./0025-source-content-hash-of-visible-text.md)
