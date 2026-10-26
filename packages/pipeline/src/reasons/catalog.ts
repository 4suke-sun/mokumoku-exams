/**
 * 理由コードの意味、よくある不採用の型、指示に足すとよい制約の候補。
 * 集計の出力(reasons コマンド)に添える。下書きの指示(エージェントの定義)の改善に使う。
 * 理由コードの一覧と意味は docs/drafting.md の「4. 判定と理由コード」と docs/fact-cards.md にある(`judge:*` は docs/exam-style/README.md の「判定の基準」)。ここでは、それを機械が引ける形で持つ。
 */

export interface ReasonInfo {
  /** 理由コードの意味 */
  meaning: string;
  /** よくある不採用の型 */
  pattern: string;
  /** 指示に足すとよい制約の候補 */
  suggestion: string;
}

/** 完全一致の理由コード */
const EXACT: Readonly<Record<string, ReasonInfo>> = {
  "unknown-domain": {
    meaning: "事実カードの分野が、資格マスタにない",
    pattern: "分野のコードを取り違える、存在しない分野を作る",
    suggestion: "分野は依頼の domains のコードだけから選ぶ",
  },
  "scope-item-out-of-range": {
    meaning: "事実カードの出題範囲の項目の番号が、試験ガイドの範囲を超えている",
    pattern: "添字を 1 から数える、項目の数を超える",
    suggestion: "scopeItems は 0 から始まる添字で、依頼の scope の長さ未満にする",
  },
  "long-copy": {
    meaning: "出典の本文を長く写している(連続一致、または数値と語の並びの一致)",
    pattern: "英語の文を語順のまま日本語に置き換える",
    suggestion: "語順と構成を変えて、自分の言葉で書く。数値と固有名詞を並べて列挙しない",
  },
  "source-not-active": {
    meaning: "根拠の出典が、台帳で有効(active)でない",
    pattern: "止まった出典を根拠にする",
    suggestion: "根拠は依頼に載った出典だけにする",
  },
  "hash-mismatch": {
    meaning: "根拠の本文のハッシュが、台帳と違う",
    pattern: "本文が更新されたあとの出典を使う",
    suggestion: "依頼の contentHash を変えずに写す",
  },
  "body-not-cached": {
    meaning: "根拠の本文がキャッシュにない",
    pattern: "収集を済ませる前に抽出する",
    suggestion: "(収集の運用)本文を取得してから抽出の依頼を出す",
  },
  "anchor-not-found": {
    meaning: "アンカーの見出しが、本文にない",
    pattern: "見出しの文を言い換える、見出しの ID を誤る",
    suggestion: "heading は本文の見出しの ID か見出しの文を、そのまま写す",
  },
  "quote-not-found": {
    meaning: "アンカーの引用が、その節にない",
    pattern: "引用を言い換える、別の節の引用を書く",
    suggestion: "quote はその節にそのまま出てくる 30 文字以内の文字列にする",
  },
  "number-mismatch": {
    meaning: "主張の数値が、アンカーの節にない",
    pattern: "記憶の数値を書く、別の節の数値を書く",
    suggestion: "数値は節に実際にあるものだけを書く",
  },
  "term-not-found": {
    meaning: "主張の固有名詞(サービス名など)が、アンカーの節にない",
    pattern: "節にない関連サービスを書き足す",
    suggestion: "固有名詞は節にある表記のまま書く。節にない語を足さない",
  },
  conflict: {
    meaning: "同じ適用範囲の別のカードと、数値が食い違う",
    pattern: "版やリージョンが違う記述を同じ範囲として抽出する",
    suggestion: "適用範囲(版・リージョン)を scope に書く",
  },
  "human-rejected": {
    meaning: "人が却下した",
    pattern: "人の確認で、内容や出典の扱いに問題があった",
    suggestion: "却下の理由コード(人の判断の記録)を、種類ごとに見る",
  },
  revised: {
    meaning: "直した下書き(ブラッシュアップ役の出力)に置き換わった",
    pattern: "保留の下書きを直し、直した下書きが取り込みを通った",
    suggestion: "欠陥ではない。直した下書きの記録(revisionOf)の側を見る(理由の集計には入れない)",
  },
  "kind-mismatch": {
    meaning: "下書きの種別が、依頼の種別と違う",
    pattern: "単一選択の依頼に複数選択を書く",
    suggestion: "questionType は依頼の kind と同じにする",
  },
  "fact-not-in-request": {
    meaning: "根拠の事実カードが、依頼にない",
    pattern: "依頼にないカードの ID を書く",
    suggestion: "factIds は依頼の facts の ID だけにする",
  },
  "review:copy-unchecked": {
    meaning: "根拠の本文がキャッシュになく、写しを確かめられない",
    pattern: "収集のやり直しが要る",
    suggestion: "(収集の運用)本文をキャッシュに戻してから下書きを作り直す",
  },
  "verify:answer-mismatch": {
    meaning: "検証役の再導出で、宣言した正解の選択肢が正しくない",
    pattern: "節にない知識で正解を決める",
    suggestion: "正解は、依頼の事実カードの主張だけから導く",
  },
  "verify:distractor-correct": {
    meaning: "誤答とした選択肢が、節では正しい",
    pattern: "条件によって正しくなる誤答を作る",
    suggestion: "設問文に条件を足して、誤答が確かに誤りになるようにする",
  },
  "verify:undetermined": {
    meaning: "節だけでは判定できない選択肢がある",
    pattern: "節に書かれていないことを誤答の根拠にする",
    suggestion: "誤答の根拠は、依頼の事実カードの主張か適用範囲の違いにする",
  },
  "verify:evidence-not-found": {
    meaning: "検証役の判定の根拠が、節に見つからない",
    pattern: "根拠の節が、設問の内容と合っていない",
    suggestion: "設問は、根拠にした事実カードの節の内容だけで解けるものにする",
  },
  "verify:explanation-conflict": {
    meaning: "解説が節と食い違う",
    pattern: "解説に記憶の補足を書く",
    suggestion: "解説は、根拠の主張の範囲だけで書く",
  },
  "verify:reason-wrong": {
    meaning: "誤答の理由が誤り",
    pattern: "誤答が誤りである理由を、別の事実で説明する",
    suggestion: "reason は、その選択肢が設問の条件のもとで誤りになる理由を、根拠の主張に沿って書く",
  },
  "verify:overclaim": {
    meaning: "適用範囲や条件を超えた、強すぎる断定がある",
    pattern: "「必ず」「すべて」で言い切る",
    suggestion: "適用範囲(版・リージョン・条件)を超える断定をしない。断定の語を避ける",
  },
  "verify:free-text-unchecked": {
    meaning: "自由記述は再導出で検証できない(人が確かめる)",
    pattern: "自由記述の下書き",
    suggestion: "(仕様)人が確かめる。改善の対象ではない",
  },
  "verify:copy": {
    meaning: "下書きが、根拠の節の本文を写している",
    pattern: "節の文を、語順のまま日本語にする",
    suggestion: "設問文・選択肢・解説を、語順と構成を変えて自分の言葉で書く",
  },
  "judge:type-mismatch": {
    meaning: "判定役の判定: 設問の型が、その資格の型から外れる(観点 J1)",
    pattern: "状況を落とした設問、設定の細部を問う設問、型に合わない選択肢",
    suggestion: "資格別の指針の「判定の基準」の J1 に沿って、設問の型を直す(書き直しで復帰できる)",
  },
  "judge:situation-unnatural": {
    meaning: "判定役の判定: 状況が不自然、または要件が答えを分けていない(観点 J2)",
    pattern: "答えと無関係な事情を足す、根拠のない要件や数値を足す",
    suggestion: "状況の要件は、答えを分けるものだけにして、事実カードで根拠を示せるものにする(書き直しで復帰できる)",
  },
  "judge:choices-weak": {
    meaning: "判定役の判定: 誤答が紛らわしくない、または選択肢の構成がそろっていない(観点 J3)",
    pattern: "別の分野の誤答、一目で誤りと分かる誤答、構成がばらばらの選択肢",
    suggestion: "誤答は、正答の部品を 1 つ入れ替えて作る。選択肢の書き出しと構成をそろえる(書き直しで復帰できる)",
  },
  "judge:explanation-inconsistent": {
    meaning: "判定役の判定: 解説が、設問・正解・選択肢と食い違う(観点 J4)",
    pattern: "解説が別の選択肢を正解として述べる、誤答の理由が設問に合わない",
    suggestion:
      "解説は、設問の条件と正解に沿って書き、誤答の理由は、その選択肢が誤りである理由にする(書き直しで復帰できる)",
  },
  "judge:not-unique": {
    meaning: "判定役の判定: 正答が 1 つに決まらない(観点 J5。書き直しでは直らない)",
    pattern: "条件が足りず、複数の選択肢が正しくなりうる。複数選択の個数が決まらない",
    suggestion: "(非公開のまま)同じ論点で、条件を足した別の設問を作る",
  },
  "judge:out-of-scope": {
    meaning: "判定役の判定: 試験の範囲外の論点を問う(観点 J5。書き直しでは直らない)",
    pattern: "試験の範囲から外れた論点を問う",
    suggestion: "(非公開のまま)範囲内の論点で、別の設問を作る",
  },
};

/** 接頭辞で引く理由コード(`style:<規則>` など) */
const PREFIXES: readonly (readonly [string, ReasonInfo])[] = [
  [
    "style:",
    {
      meaning: "止めるスタイル規則に違反した",
      pattern: "設問文の形、選択肢の数・長さ、解説の見出しなどの規則違反",
      suggestion: "依頼の styleRules を読み直し、規則の名前ごとの違反を数えて、よく違反する規則を指示で強調する",
    },
  ],
  [
    "distractor:",
    {
      meaning: "誤答の設計がない、または理由や根拠が足りない",
      pattern: "誤答ごとの設計(型・理由・根拠)を書かない",
      suggestion: "正答でない選択肢ごとに、distractors に型・理由・根拠を 1 つずつ書く",
    },
  ],
  [
    "provenance:",
    {
      meaning: "来歴を作れない(根拠の事実カードや出典に問題がある)",
      pattern: "存在しない・通過していない事実カードを根拠にする",
      suggestion: "根拠にするのは、依頼に載った通過済みの事実カードだけにする",
    },
  ],
  [
    "data-invalid:",
    {
      meaning: "問題データに組み立てると、データの契約に合わない",
      pattern: "本文に URL を書く、項目の形が違う",
      suggestion: "本文に URL や環境固有の値を書かない。項目の長さと形の上限を守る",
    },
  ],
  [
    "duplicate:",
    {
      meaning: "設問文が、公開済みの問題やほかの下書きとほぼ同じ",
      pattern: "同じ論点を言い換えて何度も作る",
      suggestion: "依頼ごとに、別の事実カードと別の論点を選ぶ。似た設問文を避ける",
    },
  ],
  [
    "ambiguous:",
    {
      meaning: "正答が複数になりうる誤答の候補",
      pattern: "誤答が条件によって正しくなる",
      suggestion: "設問文に条件を足し、誤答が確かに誤りになるようにする",
    },
  ],
  [
    "review:",
    {
      meaning: "公開済みの問題やほかの下書きに近い、または論点が同じ(人が確かめる)",
      pattern: "近い設問文や、同じ論点の問題がすでにある",
      suggestion: "既存の論点と重ならない事実カードの組を選ぶ",
    },
  ],
  [
    "verify:",
    {
      meaning: "検証の段階の指摘",
      pattern: "検証役の指摘",
      suggestion: "指摘の種類ごとに、上の個別の理由コードを見る",
    },
  ],
];

const UNKNOWN: ReasonInfo = {
  meaning: "(説明なし)",
  pattern: "(説明なし)",
  suggestion: "(説明なし)。理由コードの一覧(docs/drafting.md)で意味を確かめる",
};

/** 理由コードの説明を引く。完全一致を先に、なければ接頭辞。どちらにもなければ「説明なし」 */
export function describeReason(code: string): ReasonInfo {
  const exact = EXACT[code];
  if (exact) return exact;
  for (const [prefix, info] of PREFIXES) if (code.startsWith(prefix)) return info;
  return UNKNOWN;
}

export function hasDescription(code: string): boolean {
  return describeReason(code) !== UNKNOWN;
}

/** テストが、一覧と突き合わせるための、完全一致の理由コード */
export const DESCRIBED_CODES: readonly string[] = Object.keys(EXACT);
