# 一次情報の収集と台帳の運用

作問パイプラインの最初の段階(収集)の手順です。公式の一次情報を取得し、出典の台帳に記録し、根拠に使えるかを検査します。
出典の扱いの決まりは[出典と権利の方針](./source-policy.md)、判断の理由は ADR 0006・0007・0009 にあります。

## 1. 置き場所

| 場所 | 内容 | コミット |
| --- | --- | --- |
| `packages/pipeline/plans/<コード>.json` | 収集の計画(資格ごとに 1 つ) | する |
| `packages/pipeline/ledger/<コード>.json` | 出典の台帳(資格ごとに 1 つ) | する |
| `pipeline-work/cache/` | 取得した本文(本文のハッシュがファイル名) | しない |
| `pipeline-work/collect/<コード>/report.json` | 最後の実行の報告 | しない |
| `pipeline-work/guide/` | 試験ガイドの抽出の依頼と結果 | しない |

`<コード>` は、試験コードを英小文字にしたものです(例: `AWS-AIB-C01` なら `aws-aib-c01`)。
置き場所は `packages/pipeline/pipeline.config.json` で決まり、作業用の置き場は環境値 `PIPELINE_WORK_DIR` で変えられます。

**本文は、作業用の置き場(`pipeline-work/`)だけに置きます。** 台帳には、URL、取得日、本文のハッシュ、検査の結果、短い言い換えだけが入ります。
`pipeline-work/` は gitignore 済みで、その中のファイルや、台帳に入った本文らしい長い文章は、コミット前・push 前の検査が止めます。

## 2. 資格を新しく足すときの収集の手順

1. **許可ドメインを確かめる。** 収集する URL のホストが `ALLOWED_REFERENCE_HOSTS` にあり、`REFERENCE_HOST_VENDORS` で
   その資格のベンダーに対応していることを確かめます。なければ、[出典と権利の方針](./source-policy.md)の「4. 許可するドメインを追加する手順」で足します。
2. **計画ファイルを作る。** `packages/pipeline/plans/<コード>.json` に、次の形で書きます。

   ```json
   {
     "examCode": "EX-SMP-XX",
     "sources": [
       { "url": "https://docs.example.com/certification/guide.html", "kind": "exam-guide" },
       { "url": "https://docs.example.com/service/overview.html", "kind": "official-doc" }
     ],
     "guidePages": ["https://docs.example.com/certification/guide-domain1.html"],
     "scope": { "prefixes": ["https://docs.example.com/certification/", "https://docs.example.com/service/"], "maxDepth": 1 },
     "exclude": ["https://docs.example.com/service/archive/"],
     "regions": ["us-east-1"]
   }
   ```

   | 項目 | 意味 |
   | --- | --- |
   | `sources` | 収集を始める URL と種別(`exam-guide`・`official-doc`・`standard`)。試験ガイドは 1 つまで |
   | `guidePages` | 任意。試験ガイドの続きのページ(分野ごとの出題範囲など)。深さにかかわらず取得し、試験ガイドの抽出の材料に含める。試験ガイドと重ねない |
   | `scope.prefixes` | リンクをたどってよい URL の接頭辞。`sources` の URL も、どれかの接頭辞の中にあること |
   | `scope.maxDepth` | `sources` からリンクをたどる深さ(0〜3)。0 はたどらない |
   | `exclude` | たどらない URL の接頭辞。`sources` の URL と重ねない |
   | `regions` | 任意。対象のリージョン。台帳の出典に `target.region` があるとき、この中にないものを不合格にする |

3. **計画を検査する。** 通信も書き込みもしません。

   ```sh
   npm run pipeline -- collect <試験コード> --dry-run
   ```

4. **収集する。**

   ```sh
   npm run pipeline -- collect <試験コード>
   ```

   計画の順に、取得、キャッシュへの保存、台帳の更新、検査を行います。1 回に取得する URL の数は、設定の `maxItemsPerRun` までです。
   上限に達したら「件数の上限」を出して止まるので、もう一度実行すると、続きから進みます(同じ日に取得済みのものは取り直しません)。

5. **試験ガイドを取り込む。** 試験ガイドが検査に合格すると、`pipeline-work/guide/<コード>.request.json` に抽出の依頼が書かれます。
   依頼には、試験ガイドの本文と、計画の `guidePages` の本文の場所が入ります(`guidePages` が 1 つでも検査に合格していなければ、
   依頼を出さず「試験ガイドの抽出の保留」を出します)。試験ガイドか `guidePages` のどれかの本文が、前に取り込んだときから変わると、依頼し直します。
   Claude Code で、エージェント `guide-extractor` に、その依頼のファイルを渡して抽出させます。抽出が書かれたら、取り込みます。

   ```sh
   npm run pipeline -- collect <試験コード> --import-guide
   ```

   CLI が、抽出の形、配点の合計(100%)、分野の番号の抜け、`guidePages` をすべて材料にしていること、本文の写しでないことを検査してから、
   台帳に取り込みます。
   資格マスタ(`data/exams.json`)との差分(マスタにない分野、ガイドにない分野、配点のずれ)を報告します。
   **マスタは書き換えません。** 差分を見て、人がマスタを直すかを判断し、通常の PR で直します。

6. **台帳をコミットする。** 台帳と計画だけをコミットします(`/dev-commit`)。`pipeline-work/` の中身はコミットしません。

## 3. 取得の決まり

- https で、許可したドメインの URL だけを取得します。リダイレクトのたびに、行き先を確かめ直します。
- 同じホストへは、1 本ずつ、2 秒の間隔を空けて取得します。全体の同時の取得は 4 本までです(設定の `fetch`)。
- robots.txt に従います。取得の主体は、User-Agent の製品名 `mokumoku-exams-pipeline` で示します。robots.txt が取得できない(5xx・通信の失敗)ときは、
  そのホストからは取得しません。
- 本文の大きさ、タイムアウト、リダイレクトの回数に、上限があります(設定の `fetch`)。

## 4. 出典の検査

取得のたびに、出典ごとに 5 つの検査を行い、結果(合格 `pass`・不合格 `fail`・確認不能 `unknown`)と理由コードを台帳に書きます。
**状態が `active` の出典だけが、先の段階の根拠に使えます。** 確認不能も、不合格と同じく止めます。

| 検査 | 合格の条件 |
| --- | --- |
| `official`(公式か) | URL(リダイレクトの後も)が許可ドメインにあり、`REFERENCE_HOST_VENDORS` でそのホストが資格のベンダーに対応している |
| `target`(対象か) | 資格が計画の資格と同じで、版が資格マスタの `edition` と同じ。出典に `target.region` があり、計画に `regions` があれば、その中のリージョン |
| `deprecation`(廃止の兆候) | ページ全体の廃止・アーカイブ・試験の退役を示す言い回しがなく、410 でない。ページの中の機能の非推奨の記述には反応しない |
| `freshness`(日付) | 出典が示す更新日(meta・time 要素・Last-Modified)が 365 日以内(設定の `checks.freshnessDays`)。更新日を示さない出典は、取得日で代えて合格 |
| `liveness`(リンク) | 取得できた |

状態は、検査の結果から次のように決まります。

| 状態 | 条件 |
| --- | --- |
| `active` | すべて合格 |
| `deprecated` | `deprecation` が不合格 |
| `unreachable` | `liveness` が合格でない |
| `needs-review` | ほかの不合格・確認不能 |

## 5. 出典の本文が変わったときの再検証

- 取得した本文のハッシュが、台帳の前回のハッシュと違うと、「出典の変化」として報告します(URL、前回と今回の取得日、状態だけ)。
- 変わった出典を根拠にしている事実カードと、その事実カードを根拠にしている問題に、「再検証が必要」の印を付けます(台帳の `recheck`)。
  事実カードは、事実カードの台帳(`packages/pipeline/facts/<コード>.json`)の根拠の出典から、不採用でないカードを洗い出します。
  印の付いたものは、再検証が済むまで先の段階へ進めません。
- 取得できなかった出典は、「変化」ではなく「確認できない出典」として別に報告します。
- 再検証は、変わった出典を読み直し、事実カードと問題を確かめ直すことです。事実カードは、その出典の抽出をやり直して取り込むと、
  古いカードが新しい抽出に置き換わり、印が外れます([事実カードの作法と運用手順](./fact-cards.md)の「5. 出典が変わったとき」)。
  問題の再検証は、来歴を持つ段階(出題計画と下書き)で手順を足します。

## 6. 止まったときの対処

報告は、種類と場所(項目のパス、URL)と理由コードだけを出します。本文は出しません。

### 計画の誤り(`計画の誤り: <場所> <理由コード>`)

| 理由コード | 原因 | 直し方 |
| --- | --- | --- |
| `plan-not-found` | 計画ファイルがない | `packages/pipeline/plans/<コード>.json` を作る |
| `invalid-json` / `schema` | JSON の形・項目の誤り | 「2. 資格を新しく足すときの収集の手順」の形に合わせる |
| `exam-code-mismatch` | 中の `examCode` が、指定した資格と違う | ファイル名と `examCode` を合わせる |
| `not-https` / `malformed` / `userinfo` / `port` / `query` / `fragment` | URL の形が出典に使えない | `https://` の、ユーザー情報・既定以外のポート・クエリ文字列・フラグメントのない URL にする(クエリを持つページは、計画の候補にもリダイレクト先にもできない) |
| `host-not-allowed` | 許可ドメインにない | 許可ドメインの追加の手順を経るか、URL を外す |
| `out-of-scope` | 収集を始める URL・`guidePages` が、どの接頭辞の中にもない | `scope.prefixes` を足すか、URL を直す |
| `excluded-listed` | 収集を始める URL・`guidePages` が、除外に当たる | 一覧か除外の一方を直す |
| `duplicate` | 同じ URL・接頭辞の重複。`guidePages` と試験ガイドの重複 | 重複を消す |
| `multiple-exam-guides` | 試験ガイドが 2 つ以上 | 1 つにする |
| `no-exam-guide` | `guidePages` があるのに、試験ガイドがない | 試験ガイドを `sources` に足すか、`guidePages` を外す |

### 取得の失敗(`取得: <URL> <状態> <理由コード>`)

| 理由コード | 原因 | 直し方 |
| --- | --- | --- |
| `not-allowed` | リダイレクト先が許可外・https でない | 計画の URL を、リダイレクト後の公式の URL に直す |
| `robots-disallowed` | robots.txt が禁止している | 取得しない。計画から外すか、別の公式の資料にする |
| `robots-unreachable` | robots.txt が取得できない | 時間をおいて再実行する |
| `timeout` / `network-error` | 応答がない・通信の失敗 | 時間をおいて再実行する |
| `too-large` | 本文が大きさの上限を超えた | 対象を絞る(上限は、必要なときだけ設定で上げる) |
| `too-many-redirects` | リダイレクトが多すぎる | 最終の URL を計画に書く |
| `http-error` | 4xx・5xx | 404・410 はリンク切れ。URL を直すか外す。5xx は再実行する |

### 出典の検査(`出典の検査: <URL> <検査> <結果> <理由コード>`)

| 理由コード | 原因 | 直し方 |
| --- | --- | --- |
| `host-not-allowed` / `vendor-mismatch` | 公式と確かめられない | 資格のベンダーの公式の資料にする。対応表に足すなら、許可ドメインの追加の手順で |
| `exam-not-in-master` | 資格マスタにない | 資格マスタに資格を足す |
| `exam-mismatch` / `edition-mismatch` / `edition-unknown` | 版が合わない・マスタに版がない | 資格マスタの `edition` を確かめる。版が変わったなら、計画と資料を新しい版に合わせる |
| `region-mismatch` | 対象外のリージョン | 計画の `regions` か、資料を直す |
| `deprecation-signal` / `gone` | 廃止・アーカイブ・退役の兆候 | 後継の資料に差し替える |
| `stale` | 更新日が古い | 新しい資料に差し替える。古くても正しいと人が確かめたものは、事実カードの段階で扱いを決める |
| `future-date` / `invalid-date` | 更新日が読めない | 資料を確かめる |
| `no-body` | 本文が取れず検査できない | 取得の失敗を先に直す |
| `dead-link` / `redirect-not-allowed` | リンク切れ・許可外へのリダイレクト | URL を直すか外す |

### 試験ガイドの取り込みの停止(`試験ガイドの取り込みの停止: <理由コード>`)

| 理由コード | 原因 | 直し方 |
| --- | --- | --- |
| `extract-not-found` / `extract-invalid` | 抽出のファイルがない・形が違う | エージェントに抽出をやり直させる |
| `exam-mismatch` / `source-not-in-ledger` | 依頼と違う資格・出典の抽出 | 依頼のファイルを渡し直す |
| `source-not-active` | 試験ガイドか `guidePages` が検査に合格していない | 出典の検査の失敗を先に直す |
| `page-mismatch` | 抽出の `pages` が、計画の `guidePages` と合わない | 依頼を出し直して(収集をやり直す)、抽出をやり直させる |
| `source-hash-mismatch` / `body-not-cached` | 抽出のもとの本文が、台帳の最新と違う・キャッシュにない | 収集をやり直してから、抽出をやり直させる |
| `domain-numbering` | 分野の番号に抜けや重複がある | 抽出をやり直させる |
| `weight-sum-mismatch` | 配点の合計が 100% にならない | 試験ガイドを確かめ、抽出をやり直させる |
| `verbatim-copy` | 言い換えが本文の写しになっている | 自分の言葉で言い換えるよう、抽出をやり直させる |

### そのほか

| 表示 | 原因 | 直し方 |
| --- | --- | --- |
| `件数の上限` | 1 回の取得の数が `maxItemsPerRun` に達した | もう一度実行する(続きから進む) |
| `台帳の誤り: <場所>` | 台帳がスキーマに合わない | 場所の項目を直す。言い換え・引用の長さの上限は[出典と権利の方針](./source-policy.md)の「2」 |
| `資格マスタの誤り` | `data/exams.json` が読めない | `npm run validate:data` で確かめる |

## 7. 終了コード

| コード | 意味 |
| --- | --- |
| 0 | すべての出典が `active` |
| 1 | 止めた出典がある、計画・台帳の誤り、件数の上限、取り込みの停止 |
| 2 | 入力の誤り(資格コードの形、資格マスタにない資格) |
| 3 | 内部の誤り |
