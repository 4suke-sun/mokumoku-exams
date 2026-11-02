/**
 * 点数票の帯。項目は全資格で共通で、値(帯)だけを、ベンダー共通の層と資格別の層に分けて持つ(docs/exam-style/)。
 * 資格の帯は、ベンダー共通の帯の上に重ねる。
 */

/** 帯: 満点になる範囲と、部分点になる範囲(どちらも両端を含む) */
export interface Band {
  full: readonly [number, number];
  partial: readonly [number, number];
}

/** 問題 1 問ごとの資格別の項目(B1〜B7)の配点。合計 40 点 */
export interface BPoints {
  stemLength: number;
  contextSentences: number;
  contextRequirement: number;
  optionLength: number;
  opener: number;
  questionEnding: number;
  questionParagraph: number;
}

export interface BatchBands {
  /** 複数選択の割合 */
  multiShare: readonly [number, number];
  /** 状況の文(問いより前の文)がある設問の割合 */
  situationShare: readonly [number, number];
  /** 設問文の長さの中央値の帯と、90 パーセンタイルの上限 */
  stemMedian: readonly [number, number];
  stemP90Max: number;
  /** 選択肢の形の割合の帯。null は検査しない */
  nameShare: readonly [number, number] | null;
  phraseShare: readonly [number, number] | null;
  sentenceShare: readonly [number, number];
  /** 設問文の先頭が同じものの最大割合の上限と、先頭を見る文字数 */
  openerTopMax: number;
  openerPrefixChars: number;
}

export interface ScorecardProfile {
  /** 設問文の文字数(複数選択の表記を除く) */
  stemLength: Band;
  /** 問いより前の文の数 */
  contextSentences: readonly [number, number];
  /** 最長の選択肢の文字数: 満点の上限と部分点の上限 */
  optionMaxLength: readonly [number, number];
  /** 最長÷最短の上限: 満点と部分点 */
  lengthRatio: readonly [number, number];
  /** 選択肢の組のバイグラム Dice の上限(これ未満で通る) */
  similarityMax: number;
  /** 状況の書き出しとして許す語(正規表現の文字列。文頭に当てる) */
  openers: readonly string[];
  /** 設問文を、状況の段落と問いの段落に分けるか */
  separateQuestionParagraph: boolean;
  points: BPoints;
  batch: BatchBands;
}

/** 合格点: 問題 1 問ごと(100 点満点)と、束(100 点満点)。束は、この問題数以上のときだけ採点する */
export const PASSING = { question: 80, batch: 70, batchMinQuestions: 20 } as const;

/** ベンダーごとの共通の帯。資格別の帯が重ならない項目の既定になる */
export const VENDOR_PROFILES: Readonly<Record<string, ScorecardProfile>> = {
  AWS: {
    stemLength: { full: [35, 125], partial: [25, 160] },
    contextSentences: [0, 2],
    optionMaxLength: [40, 60],
    lengthRatio: [4, 6],
    similarityMax: 0.85,
    openers: [
      "ある(企業|会社|組織|団体|開発者|デベロッパー)",
      "あなた",
      "[A-ZＡ-Ｚ]\\s*社",
      "企業は",
      "会社は",
      ".{1,12}(企業|会社|チーム|部門)は",
    ],
    separateQuestionParagraph: false,
    points: {
      stemLength: 12,
      contextSentences: 8,
      contextRequirement: 8,
      optionLength: 4,
      opener: 4,
      questionEnding: 4,
      questionParagraph: 0,
    },
    batch: {
      multiShare: [0, 0.6],
      situationShare: [0, 0.8],
      stemMedian: [55, 100],
      stemP90Max: 135,
      nameShare: [0.3, 0.7],
      phraseShare: [0, 0.45],
      sentenceShare: [0, 0.3],
      openerTopMax: 0.25,
      openerPrefixChars: 8,
    },
  },
  // Databricks: 状況の問と、1 文の知識の問が混ざる。選択肢は製品名・語句・文が混在する
  DBX: {
    stemLength: { full: [30, 320], partial: [20, 420] },
    contextSentences: [0, 5],
    optionMaxLength: [100, 150],
    lengthRatio: [3.5, 5],
    similarityMax: 0.9,
    openers: [
      "ある.{0,20}?(企業|会社|組織|団体|チーム|部門|データエンジニア|エンジニア)",
      "(ジュニア)?データエンジニア",
      "あなた",
      ".{1,12}(企業|会社|チーム|部門)は",
    ],
    separateQuestionParagraph: false,
    points: {
      stemLength: 12,
      contextSentences: 8,
      contextRequirement: 8,
      optionLength: 4,
      opener: 4,
      questionEnding: 4,
      questionParagraph: 0,
    },
    batch: {
      multiShare: [0, 0.15],
      situationShare: [0.5, 0.8],
      stemMedian: [100, 190],
      stemP90Max: 340,
      nameShare: null,
      phraseShare: null,
      sentenceShare: [0, 0.5],
      openerTopMax: 0.4,
      openerPrefixChars: 8,
    },
  },
};

/** 資格別の帯。ベンダー共通の帯の上に重ねる項目だけを書く */
export interface ExamOverride {
  stemLength?: Band;
  contextSentences?: readonly [number, number];
  optionMaxLength?: readonly [number, number];
  lengthRatio?: readonly [number, number];
  similarityMax?: number;
  openers?: readonly string[];
  separateQuestionParagraph?: boolean;
  points?: Partial<BPoints>;
  batch?: Partial<BatchBands>;
}

export const EXAM_OVERRIDES: Readonly<Record<string, ExamOverride>> = {
  // Cloud Practitioner: 設問は短く、選択肢はサービス名が中心(ベンダー共通の帯のまま)
  "AWS-CLF-C02": {},
  // Developer - Associate: 設問は長く、状況の段落と問いの段落を分ける。選択肢は手順や設定を述べる文で、並行する
  "AWS-DVA-C02": {
    stemLength: { full: [150, 360], partial: [110, 450] },
    contextSentences: [2, 6],
    optionMaxLength: [150, 220],
    lengthRatio: [3, 4.5],
    similarityMax: 0.97,
    separateQuestionParagraph: true,
    points: { contextRequirement: 6, optionLength: 3, opener: 3, questionEnding: 3, questionParagraph: 5 },
    batch: {
      situationShare: [0.9, 1],
      stemMedian: [180, 290],
      stemP90Max: 370,
      nameShare: null,
      phraseShare: null,
      sentenceShare: [0.8, 1],
      openerTopMax: 0.45,
      openerPrefixChars: 8,
    },
  },
  // AI Business Strategist: 設問は中くらいの長さで、状況の段落と問いの段落を分ける。単一選択だけで、選択肢は短い文が並行する
  "AWS-AIB-C01": {
    stemLength: { full: [120, 300], partial: [90, 360] },
    contextSentences: [2, 6],
    optionMaxLength: [100, 140],
    lengthRatio: [2.5, 3.5],
    openers: ["ある.{0,20}?(企業|会社|銀行|組織|団体|機関|法人|メーカー|社)", "あなた"],
    separateQuestionParagraph: true,
    points: { contextRequirement: 6, optionLength: 3, opener: 3, questionEnding: 3, questionParagraph: 5 },
    batch: {
      multiShare: [0, 0],
      situationShare: [0.9, 1],
      stemMedian: [160, 240],
      stemP90Max: 300,
      nameShare: null,
      phraseShare: null,
      sentenceShare: [0.8, 1],
      openerTopMax: 0.45,
      openerPrefixChars: 8,
    },
  },
  // Data Engineer Associate: 状況の問が約 6 割、知識の問が約 4 割。単一選択が中心で、複数選択は約 1 割(上限はベンダー共通)。
  // 書き出しの偏りの上限は、公式の試験ガイドの例題(10 問のうち 6 問が「データエンジニア」から書き出す。チームを含めると 8 問)に合わせる
  "DBX-DEA-2605": {
    batch: { situationShare: [0.5, 0.75], stemMedian: [120, 180], openerTopMax: 0.7 },
  },
};

/** 資格の書き方の指針の文書(リポジトリ直下からの相対パス)。ベンダー共通の文書、資格別の文書の順。帯のない資格は null */
export function styleGuidePaths(examCode: string): string[] | null {
  if (resolveProfile(examCode) === null) return null;
  const vendor = vendorOf(examCode).toLowerCase();
  const abbr = (examCode.split("-")[1] ?? "").toLowerCase();
  return [`docs/exam-style/${vendor}-common.md`, `docs/exam-style/${vendor}-${abbr}.md`];
}

/** 資格コードのベンダー略称(`AWS-CLF-C02` なら `AWS`) */
export function vendorOf(examCode: string): string {
  return examCode.split("-")[0] ?? "";
}

/** 資格の点数票の帯。ベンダー共通の帯もなければ、資格別の帯もない資格は null */
export function resolveProfile(examCode: string): ScorecardProfile | null {
  const base = VENDOR_PROFILES[vendorOf(examCode)];
  const override = EXAM_OVERRIDES[examCode];
  if (base === undefined || override === undefined) return null;
  return {
    ...base,
    ...override,
    stemLength: override.stemLength ?? base.stemLength,
    points: { ...base.points, ...override.points },
    batch: { ...base.batch, ...override.batch },
  };
}
