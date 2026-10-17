# 作問パイプラインの進め方

`packages/pipeline` を開発するときの手順です。パイプラインで問題を作る手順は[問題を作る手順書](./question-production.md)にあります。このリポジトリの規約(`CLAUDE.md`)は、pipeline の変更にもそのまま及びます。
設計の判断は [ADR 0005〜0011](./app/adr/README.md)、出典の扱いは[出典と権利の方針](./source-policy.md)、
収集の段階の手順は[一次情報の収集と台帳の運用](./source-collection.md)、
事実カードの段階の手順は[事実カードの作法と運用手順](./fact-cards.md)、
出題計画と下書きの手順は[出題計画と下書きの手順](./drafting.md)、作り方の決まりは[作問のスタイルガイド](./question-style.md)にあります。

## 1. 構成と境界

- `packages/pipeline` は、`packages/app`・`packages/infra`・`packages/data-schema` と並ぶワークスペースです。
- pipeline は、app など他のワークスペースの内部を import しません。共有してよいのは `packages/data-schema`(データの契約)だけです。
  `npm run check:boundary` が CI で検査します。
- 公開した問題の正は `data/` です。pipeline は、書き出し(`export`)の段階だけ、作業ツリーの `data/` に追加の分を書きます。ほかの段階は読み取るだけです。取り込みは、その差分を通常の PR で確かめて行います(ADR 0014)。

## 2. 検査と承認の流れ

commit・push・PR・Issue の起票は、pipeline の変更でも `CLAUDE.md` の「検査と承認の流れ」に従います(`/dev-commit` `/dev-push` `/dev-pr`)。
文面を書く側と確かめる側は、別のサブエージェントにします。

## 3. 環境値

- API キーなどの環境値は、`packages/pipeline/.env`(gitignore 済み)にだけ置きます。
- `packages/pipeline/.env.example` には、プレースホルダーだけを書きます。
- 設定ファイル(`pipeline.config.json`)は、コミットします。環境値は入れません。
- 取得した本文や作業中の成果物は、`pipeline-work/`(gitignore 済み)にだけ置きます。

## 4. 版と Issue の切り方

- 1 つの版を 1 つのマイルストーン(名前は `vX.Y.Z`)にし、1 つの PR にまとめます。版の番号は、Issue の本文に書かず、マイルストーンだけで持ちます([CONTRIBUTING.md](../CONTRIBUTING.md) の「Issue」)。
- 1 つのタスクを 1 つの Issue にします。
- Issue のタイトルは Conventional Commits の形(`feat(pipeline): …` など)にします。
- Issue の本文に、ほかの Issue の番号は書きません。前提は、タイトルで示します。

## 5. テストの方針

- pipeline のテストは、fixture だけを使います。外部へ通信しません(テストの初期化が、`fetch`・ソケット・`dns` を失敗にします)。
- ネットワークを使うテストは、CI に入れません。
- API キーなどの環境値は、CI のテストに渡しません。
