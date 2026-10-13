# pipeline(作問パイプライン)

問題を、品質と費用を管理しながら作るための道具です。判断の理由は、`docs/app/adr/` の ADR 0005〜0010 にあります。

## 境界

- `packages/app` の内部は import しません。共有するのは契約(データの仕様、スキーマと検査、出典に許すドメインの一覧)だけです。
- 公開した問題の正は `data/` です。pipeline は読み取り専用で参照し、追加・更新を差分として出します。
- 一次情報の本文はコミットしません。台帳には、リンク、取得日、本文のハッシュ、言い換えだけを持ちます。

## 実行方法

ルートから実行します。

```sh
npm run pipeline -- --help
npm run typecheck -w @mokumoku-exams/pipeline
npm test -w @mokumoku-exams/pipeline
```

## 置き場所の決まり

| 場所 | 用途 | コミット |
| --- | --- | --- |
| `src/` | コードとテスト | する |
| 台帳 | 出典の記録(資格ごとの JSON) | する |
| `pipeline-work/`(リポジトリ直下) | 取得した本文、段階の成果物 | しない(gitignore。混入はコミット前・push 前の検査が止める) |
