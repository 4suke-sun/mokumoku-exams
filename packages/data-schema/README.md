# data-schema(データの契約)

資格マスタ・問題・カリキュラム・要約・ヘルプのデータの形(Zod のスキーマ)と検査、出典に許すドメインの一覧
(`ALLOWED_REFERENCE_HOSTS`)の正本です。アプリ(`packages/app`)、`scripts/`、作問パイプライン(`packages/pipeline`)が、
同じ定義を使います。判断の理由は ADR 0011 にあります。

## 公開する範囲

`package.json` の `exports` に並べたものだけが、外から使えます(各データ種別の `schema` と `validate`)。
内部のファイルを、パスを指定して直接 import しません。

## 決まり

- 実行時の依存は `zod` だけです。他のワークスペースを import しません。
- スキーマを変えたら、`docs/data-spec.md` と `npm run validate:data` の結果を確かめます。
