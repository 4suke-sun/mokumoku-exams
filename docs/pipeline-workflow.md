# 作問パイプラインの進め方

`packages/pipeline` を開発するときの手順です。このリポジトリの規約(`CLAUDE.md`)は、pipeline の変更にもそのまま及びます。
設計の判断は [ADR 0005〜0011](./app/adr/README.md)、出典の扱いは[出典と権利の方針](./source-policy.md)にあります。

## 1. 構成と境界

- `packages/pipeline` は、`packages/app`・`packages/infra`・`packages/data-schema` と並ぶワークスペースです。
- pipeline は、app など他のワークスペースの内部を import しません。共有してよいのは `packages/data-schema`(データの契約)だけです。
  `npm run check:boundary` が CI で検査します。
- 公開した問題の正は `data/` です。pipeline は読み取り専用で参照し、追加・更新を差分として出します。

## 2. 検査と承認の流れ

commit・push・PR・Issue の起票は、pipeline の変更でも `CLAUDE.md` の「検査と承認の流れ」に従います(`/dev-commit` `/dev-push` `/dev-pr`)。
文面を書く側と確かめる側は、別のサブエージェントにします。

## 3. 環境値

- API キーなどの環境値は、`packages/pipeline/.env`(gitignore 済み)にだけ置きます。
- `packages/pipeline/.env.example` には、プレースホルダーだけを書きます。
- 設定ファイル(`pipeline.config.json`)は、コミットします。環境値は入れません。
- 取得した本文や作業中の成果物は、`pipeline-work/`(gitignore 済み)にだけ置きます。

## 4. 版と Issue の切り方

- 1 つの版を 1 つのマイルストーンにし、1 つの PR にまとめます。
- 1 つのタスクを 1 つの Issue にします。
- Issue のタイトルは Conventional Commits の形(`feat(pipeline): …` など)にします。
- Issue の本文に、ほかの Issue の番号は書きません。前提は、タイトルで示します。

## 5. テストの方針

- pipeline のテストは、fixture だけを使います。外部へ通信しません(テストの初期化が、`fetch`・ソケット・`dns` を失敗にします)。
- ネットワークを使うテストは、CI に入れません。
- API キーなどの環境値は、CI のテストに渡しません。
