import { describe, expect, it } from "vitest";
import {
  ALLOWED_REFERENCE_HOSTS,
  CRITERION_NAME_MAX,
  containsUrl,
  ExamsFileSchema,
  KEYWORD_MAX,
  normalizeKeyword,
  normalizeText,
  QuestionsFileSchema,
  REFERENCE_TITLE_MAX,
  REFERENCES_MAX,
  referenceUrlProblem,
} from "./schema.ts";
import { validateDataSet } from "./validate.ts";

const published = (overrides: Record<string, unknown> = {}) => ({
  examCode: "EX-SMP-XX",
  idPrefix: "SAMPLE",
  status: "published",
  vendor: "Example",
  edition: "S01",
  name: "サンプル資格",
  shortName: "サンプル",
  category: "Foundational",
  passingScore: 70,
  totalScore: 100,
  officialQuestionCount: 2,
  officialTimeMinutes: 10,
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.5 },
    { code: "domain2", name: "分野 2", weight: 0.5 },
  ],
  ...overrides,
});

const comingSoon = (overrides: Record<string, unknown> = {}) => ({
  examCode: "EX-LTR-XX",
  status: "coming-soon",
  vendor: "Example",
  name: "近日公開の資格",
  shortName: "近日公開",
  ...overrides,
});

const question = (n: number, overrides: Record<string, unknown> = {}) => ({
  questionId: `SAMPLE-${String(n).padStart(4, "0")}`,
  examCode: "EX-SMP-XX",
  domain: "domain1",
  questionType: "single",
  questionText: `設問 ${n}`,
  choices: [
    { key: "A", text: `選択肢 ${n}-A` },
    { key: "B", text: `選択肢 ${n}-B` },
  ],
  correctAnswers: ["A"],
  explanation: "解説",
  ...overrides,
});

const freeText = (n: number, overrides: Record<string, unknown> = {}) => ({
  questionId: `SAMPLE-${String(n).padStart(4, "0")}`,
  examCode: "EX-SMP-XX",
  domain: "domain2",
  questionType: "free-text",
  questionText: `記述の設問 ${n}`,
  rubric: {
    criteria: [
      { name: "観点 1", keywords: ["キーワード 1"], points: 60 },
      { name: "観点 2", keywords: ["キーワード 2", "言い換え 2"], points: 40 },
    ],
    passingPoints: 60,
  },
  explanation: "解説",
  ...overrides,
});

const questionsFile = (questions: unknown[] = [question(1), question(2)]) => ({ examCode: "EX-SMP-XX", questions });
const exams = (list: unknown[] = [published()]) => ({ exams: list });
const files = (data: unknown = questionsFile()) => [{ name: "questions.ex-smp-xx.json", data }];

describe("資格マスタのスキーマ", () => {
  it("公開中と近日公開の両方を通す", () => {
    expect(ExamsFileSchema.safeParse(exams([published(), comingSoon()])).success).toBe(true);
  });

  it("公開中の資格に必須の項目が欠けていたら止める", () => {
    const { passingScore: _omit, ...rest } = published();
    expect(ExamsFileSchema.safeParse(exams([rest])).success).toBe(false);
  });

  it("近日公開の資格は、最小限の項目だけでよい。未知の項目は止める", () => {
    expect(ExamsFileSchema.safeParse(exams([comingSoon()])).success).toBe(true);
    expect(ExamsFileSchema.safeParse(exams([comingSoon({ domains: [] })])).success).toBe(false);
  });

  it("合格点が満点を超える・分野の重みの合計が 1 でない・分野のコードが重複する", () => {
    const messages = (e: unknown) => {
      const r = ExamsFileSchema.safeParse(exams([e]));
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(messages(published({ passingScore: 120 }))).toContain("合格点が満点を超えています");
    expect(messages(published({ domains: [{ code: "domain1", name: "a", weight: 0.5 }] }))).toContain(
      "分野の重みの合計が 1 ではありません(許容誤差 0.005)",
    );
    const dup = [
      { code: "domain1", name: "a", weight: 0.5 },
      { code: "domain1", name: "b", weight: 0.5 },
    ];
    expect(messages(published({ domains: dup }))).toContain("分野のコードが重複しています");
  });

  it("資格マスタの表示名・分野名・添える文言の URL を止める", () => {
    const url = "https://example.com/";
    const invalid = [
      published({ name: `資格 ${url}` }),
      published({ domains: [{ code: "domain1", name: `分野 ${url}`, weight: 1 }] }),
      comingSoon({ note: `近日公開 ${url}` }),
    ];
    for (const exam of invalid) {
      expect(ExamsFileSchema.safeParse(exams([exam])).success).toBe(false);
    }
  });

  it("資格のコードの重複を止める", () => {
    const r = ExamsFileSchema.safeParse(exams([published(), published()]));
    expect(r.success).toBe(false);
  });
});

describe("資格マスタのレベル・略称・資格の情報", () => {
  const info = (overrides: Record<string, unknown> = {}) => ({ checkedAt: "2026-10-12", ...overrides });
  const errors = (list: unknown[]) => validateDataSet(exams(list), files());

  it("追加した項目はすべて任意_持たない資格もそのまま通す", () => {
    expect(errors([published(), comingSoon()])).toEqual([]);
  });

  it("レベルと略称_公開中にも近日公開にも持てる", () => {
    const list = [published({ level: "Associate", abbr: "SMP" }), comingSoon({ level: "Specialty", abbr: "LT2" })];
    expect(errors(list)).toEqual([]);
  });

  it("レベルの値_一覧にあるものだけ", () => {
    for (const level of ["Foundational", "Associate", "Professional", "Expert", "Specialty"]) {
      expect(errors([published({ level })])).toEqual([]);
    }
    expect(errors([published({ level: "Beginner" })])).not.toEqual([]);
    expect(errors([comingSoon({ level: "foundational" })])).not.toEqual([]);
  });

  it("略称_英数字 1〜4 文字だけ", () => {
    expect(errors([published({ abbr: "AIB1" })])).toEqual([]);
    for (const abbr of ["", "ABCDE", "あい", "A B", "A-B"]) {
      expect(errors([published({ abbr })]), abbr).not.toEqual([]);
    }
  });

  it("資格の情報_すべての項目を持つ形を通す", () => {
    const full = info({
      format: "択一選択式と複数選択式",
      languages: ["日本語", "英語"],
      fee: { amount: 100, currency: "USD", note: "ベータ試験は別の価格" },
      validityYears: 3,
      guideUrl:
        "https://docs.aws.amazon.com/aws-certification/latest/ai-business-strategist-01/ai-business-strategist-01.html",
    });
    expect(errors([published({ info: full })])).toEqual([]);
  });

  it("資格の情報_確認した日だけでもよい_確認した日がないと止める", () => {
    expect(errors([published({ info: info() })])).toEqual([]);
    expect(errors([published({ info: { format: "択一選択式" } })])).toEqual([
      "exams.json: exams[0].info.checkedAt: 型が違います",
    ]);
  });

  it("確認した日_実在しない日付・形の違う日付を止める", () => {
    for (const checkedAt of ["2026-02-30", "2026-13-01", "2026/10/12", "20261012", "今日"]) {
      expect(errors([published({ info: info({ checkedAt }) })]), checkedAt).not.toEqual([]);
    }
  });

  it("公式の試験ガイドの URL_許したドメインの https だけ", () => {
    const guide = (guideUrl: string) => errors([published({ info: info({ guideUrl }) })]);
    expect(guide("https://aws.amazon.com/certification/certified-ai-business-strategist/")).toEqual([]);
    expect(guide("https://learning.example.com/guide")).toEqual([
      "exams.json: exams[0].info.guideUrl: 出典に許していないドメインの URL です",
    ]);
    expect(guide("http://docs.aws.amazon.com/guide")).toEqual([
      "exams.json: exams[0].info.guideUrl: https で始まる URL ではありません",
    ]);
    expect(guide("https://user@docs.aws.amazon.com/guide")).not.toEqual([]);
    expect(guide("https://docs.aws.amazon.com:8443/guide")).not.toEqual([]);
    expect(guide("https://docs.aws.amazon.com.example.com/guide")).not.toEqual([]);
  });

  it("受験料_金額は正の数・通貨は大文字 3 文字・補足は 80 文字まで", () => {
    const fee = (value: Record<string, unknown>) => errors([published({ info: info({ fee: value }) })]);
    expect(fee({ amount: 100, currency: "USD" })).toEqual([]);
    expect(fee({ amount: 15000, currency: "JPY" })).toEqual([]);
    for (const bad of [
      { amount: 0, currency: "USD" },
      { amount: -1, currency: "USD" },
      { amount: 100, currency: "usd" },
      { amount: 100, currency: "US" },
      { amount: 100 },
      { currency: "USD" },
      { amount: 100, currency: "USD", note: "あ".repeat(81) },
      { amount: 100, currency: "USD", extra: 1 },
    ]) {
      expect(fee(bad), JSON.stringify(Object.keys(bad))).not.toEqual([]);
    }
  });

  it("有効期間・言語・出題形式_範囲と長さを止める", () => {
    const withInfo = (value: Record<string, unknown>) => errors([published({ info: info(value) })]);
    expect(withInfo({ validityYears: 3 })).toEqual([]);
    for (const bad of [
      { validityYears: 0 },
      { validityYears: 11 },
      { validityYears: 2.5 },
      { languages: [] },
      { languages: ["あ".repeat(21)] },
      { format: "あ".repeat(81) },
      { format: "  " },
      { extra: 1 },
    ]) {
      expect(withInfo(bad), JSON.stringify(bad)).not.toEqual([]);
    }
  });

  it("資格の情報の文字_URL を止める(URL は guideUrl だけ)", () => {
    expect(errors([published({ info: info({ format: "https://example.com/ を見る" }) })])).toEqual([
      "exams.json: exams[0].info.format: 本文に URL が含まれています",
    ]);
    expect(
      errors([published({ info: info({ fee: { amount: 1, currency: "USD", note: "www.example.com" } }) })]),
    ).not.toEqual([]);
  });

  it("近日公開の資格_情報(info)は持てない", () => {
    expect(errors([comingSoon({ info: info() })])).not.toEqual([]);
  });

  it("報告に入力の値を含めない", () => {
    const marker = "目印XYZ";
    const result = errors([published({ info: { checkedAt: marker, guideUrl: `https://${marker}.example.com/` } })]);
    expect(result.length).toBeGreaterThan(0);
    expect(result.join("\n")).not.toContain(marker);
  });
});

describe("問題のスキーマ", () => {
  const messages = (q: unknown) => {
    const r = QuestionsFileSchema.safeParse(questionsFile([q]));
    return r.success ? [] : r.error.issues.map((i) => i.message);
  };

  it("正しい問題を通す(択一・複数選択)", () => {
    expect(QuestionsFileSchema.safeParse(questionsFile()).success).toBe(true);
    const multiple = question(3, {
      questionType: "multiple",
      choices: [
        { key: "A", text: "a" },
        { key: "B", text: "b" },
        { key: "C", text: "c" },
      ],
      correctAnswers: ["A", "C"],
    });
    expect(QuestionsFileSchema.safeParse(questionsFile([multiple])).success).toBe(true);
  });

  it("選択肢のキーが A から連番でないとき", () => {
    const q = question(1, {
      choices: [
        { key: "A", text: "a" },
        { key: "C", text: "c" },
      ],
    });
    expect(messages(q)).toContain("選択肢のキーが A から連番になっていません");
  });

  it("正解が選択肢にない・重複している・種類と数が合わない", () => {
    expect(messages(question(1, { correctAnswers: ["Z"] }))).toContain("正解が選択肢のキーにありません");
    expect(messages(question(1, { correctAnswers: ["A", "A"] }))).toContain("正解が重複しています");
    expect(messages(question(1, { questionType: "multiple" }))).toContain("問題の種類が正解の数と一致しません");
    expect(messages(question(1, { correctAnswers: [] }))).not.toEqual([]);
  });

  it("同じ文言の選択肢(空白・全角半角の違いを除く)を止める", () => {
    const q = question(1, {
      choices: [
        { key: "A", text: "ＡＢＣ  def" },
        { key: "B", text: "ABC def" },
      ],
    });
    expect(messages(q)).toContain("同じ文言の選択肢があります");
    expect(normalizeText("ＡＢＣ  def")).toBe("ABC def");
  });

  it("未知の項目・不正な URL・空白だけの文字列を止める", () => {
    expect(messages(question(1, { extra: 1 }))).not.toEqual([]);
    expect(messages(question(1, { references: [{ title: "t", url: "ftp://example.com" }] }))).not.toEqual([]);
    expect(messages(question(1, { questionText: "  " }))).not.toEqual([]);
  });

  it("本文(設問文・選択肢・解説・補足・観点名)の URL を止める_出典の URL は通す", () => {
    const url = "https://example.com/";
    for (const over of [
      { questionText: `設問 ${url}` },
      { explanation: "解説 http://example.com" },
      { supplement: "補足 www.example.com" },
      {
        choices: [
          { key: "A", text: "選択肢 A" },
          { key: "B", text: `選択肢 B ${url}` },
        ],
      },
      {
        choices: [
          { key: "A", text: "選択肢 A", explanation: `解説 ${url}` },
          { key: "B", text: "選択肢 B" },
        ],
      },
    ]) {
      expect(messages(question(1, over)), Object.keys(over)[0]).toContain("本文に URL が含まれています");
    }
    const rubric = { criteria: [{ name: `観点 ${url}`, keywords: ["k"], points: 1 }], passingPoints: 1 };
    expect(messages(freeText(1, { rubric }))).toContain("本文に URL が含まれています");
    expect(messages(question(1, { references: [{ title: "出典", url: "https://docs.aws.amazon.com/" }] }))).toEqual([]);
    expect(containsUrl("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(containsUrl("URL を書かない")).toBe(false);
  });

  it("出典_許したドメインの https の URL を通す。題は任意", () => {
    const references = ALLOWED_REFERENCE_HOSTS.map((host, i) =>
      i === 0 ? { url: `https://${host}/path?q=1#top` } : { title: `出典 ${i}`, url: `https://${host}/` },
    );
    expect(messages(question(1, { references }))).toEqual([]);
  });

  it("出典_一覧にないドメイン・http・ユーザー情報やポート付き・URL の形でないものを止める", () => {
    const cases: [string, string][] = [
      ["https://learning.example.com/aws/course", "出典に許していないドメインの URL です"],
      ["https://docs.aws.amazon.com.example.com/", "出典に許していないドメインの URL です"],
      ["https://sub.docs.aws.amazon.com/", "出典に許していないドメインの URL です"],
      ["http://docs.aws.amazon.com/", "https で始まる URL ではありません"],
      ["https://user:pass@docs.aws.amazon.com/", "ユーザー情報付きの URL です"],
      ["https://user@docs.aws.amazon.com/", "ユーザー情報付きの URL です"],
      ["https://docs.aws.amazon.com:8443/", "ポート付きの URL です"],
      ["https://docs.aws.amazon.com/ path", "https で始まる URL ではありません"],
      ["ftp://docs.aws.amazon.com/", "https で始まる URL ではありません"],
    ];
    for (const [url, kind] of cases) {
      expect(messages(question(1, { references: [{ url }] })), url).toEqual([kind]);
    }
    expect(referenceUrlProblem("https://aws.amazon.com/")).toBeNull();
  });

  it("出典_ホスト名の書き方のゆれ_URL として読んだあとのホスト名とポートで判定する", () => {
    // 末尾のドット付きのホスト名は、完全一致にならないので止める
    expect(referenceUrlProblem("https://docs.aws.amazon.com./x")).toBe("出典に許していないドメインの URL です");
    // ホスト名の大文字は、URL として読むと小文字になるので、許すドメインと同じに扱う
    expect(referenceUrlProblem("https://DOCS.AWS.AMAZON.COM/x")).toBeNull();
    // https の既定のポート(443)は、URL として読むとポートなしになるので、ポート付きとして扱わない
    expect(referenceUrlProblem("https://docs.aws.amazon.com:443/x")).toBeNull();
  });

  it("出典_空の一覧・多すぎる・重複・題が長すぎる・未知の項目を止める", () => {
    const ref = (n: number) => ({ url: `https://docs.aws.amazon.com/${n}` });
    expect(messages(question(1, { references: [] }))).not.toEqual([]);
    const many = Array.from({ length: REFERENCES_MAX + 1 }, (_, i) => ref(i));
    expect(messages(question(1, { references: many }))).not.toEqual([]);
    expect(messages(question(1, { references: [ref(1), ref(1)] }))).toEqual(["出典の URL が重複しています"]);
    const longTitle = { ...ref(1), title: "a".repeat(REFERENCE_TITLE_MAX + 1) };
    expect(messages(question(1, { references: [longTitle] }))).not.toEqual([]);
    expect(messages(question(1, { references: [{ ...ref(1), lang: "en" }] }))).not.toEqual([]);
  });

  it("出典の誤りの報告に、URL の値を載せない", () => {
    const marker = "learning.example.com";
    const q = question(1, { references: [{ url: `https://${marker}/x` }, { url: `http://${marker}/y` }] });
    const errors = validateDataSet(exams(), files(questionsFile([q, question(2)])));
    expect(errors).toEqual([
      "questions.ex-smp-xx.json: questions[0].references[0].url(SAMPLE-0001): 出典に許していないドメインの URL です",
      "questions.ex-smp-xx.json: questions[0].references[1].url(SAMPLE-0001): https で始まる URL ではありません",
    ]);
    expect(errors.join("\n")).not.toContain(marker);
  });

  it("タグの URL を止める", () => {
    expect(messages(question(1, { tags: ["タグ"] }))).toEqual([]);
    expect(messages(question(1, { tags: ["タグ https://example.com/"] }))).toEqual(["本文に URL が含まれています"]);
  });

  it("自由記述の問題を通す_選択式の問題と同じファイルに混ぜられる", () => {
    expect(QuestionsFileSchema.safeParse(questionsFile([question(1), freeText(2)])).success).toBe(true);
  });

  it("自由記述の問題_採点基準がない・選択肢や正解を持つ・観点の形が違うときは止める", () => {
    const { rubric: _omit, ...withoutRubric } = freeText(1);
    expect(messages(withoutRubric)).not.toEqual([]);
    expect(messages(freeText(1, { choices: [{ key: "A", text: "a" }] }))).not.toEqual([]);
    expect(messages(freeText(1, { correctAnswers: ["A"] }))).not.toEqual([]);
    const badCriterion = { criteria: [{ name: "観点", keywords: ["a"], points: 0 }], passingPoints: 1 };
    expect(messages(freeText(1, { rubric: badCriterion }))).not.toEqual([]);
    const blankKeyword = { criteria: [{ name: "観点", keywords: [" "], points: 1 }], passingPoints: 1 };
    expect(messages(freeText(1, { rubric: blankKeyword }))).not.toEqual([]);
  });

  describe("採点基準(rubric)", () => {
    const criterion = (overrides: Record<string, unknown> = {}) => ({
      name: "観点",
      keywords: ["キーワード"],
      points: 50,
      ...overrides,
    });
    const rubric = (criteria: unknown[], passingPoints = 50) => ({ criteria, passingPoints });
    /** 自由記述の問題を 1 問だけ持つファイルを検査し、場所と種類の報告を返す */
    const report = (r: unknown) =>
      validateDataSet(exams(), files(questionsFile([question(1), question(2), freeText(3, { rubric: r })])));
    const at = (place: string, kind: string) =>
      `questions.ex-smp-xx.json: questions[2].rubric${place}(SAMPLE-0003): ${kind}`;

    it("正しい採点基準を通す_合格点が配点の合計ちょうどでもよい", () => {
      expect(report(rubric([criterion({ name: "観点 1" }), criterion({ name: "観点 2" })], 100))).toEqual([]);
    });

    it("観点が空の配列_止める", () => {
      // 配点の合計が 0 になるので、合格点の規則にもかかる
      expect(report(rubric([]))).toContain(at(".criteria", "少なすぎる(短い・小さい)値です"));
    });

    it("キーワードが空の配列_止める", () => {
      expect(report(rubric([criterion({ keywords: [] })]))).toEqual([
        at(".criteria[0].keywords", "少なすぎる(短い・小さい)値です"),
      ]);
    });

    it("合格点が配点の合計より大きい_止める", () => {
      const r = rubric([criterion({ name: "観点 1", points: 30 }), criterion({ name: "観点 2", points: 20 })], 51);
      expect(report(r)).toEqual([at(".passingPoints", "合格点が配点の合計を超えています")]);
    });

    it("観点名の重複(空白と全角・半角の違いを除く)_止める", () => {
      expect(report(rubric([criterion({ name: "観点 1" }), criterion({ name: "観点 1" })]))).toEqual([
        at(".criteria", "観点名が重複しています"),
      ]);
      expect(report(rubric([criterion({ name: "観点 １" }), criterion({ name: "観点  1" })]))).toEqual([
        at(".criteria", "観点名が重複しています"),
      ]);
    });

    it("観点名・キーワードが上限の文字数を超える_止める。上限ちょうどは通す", () => {
      const ok = rubric([criterion({ name: "名".repeat(CRITERION_NAME_MAX), keywords: ["語".repeat(KEYWORD_MAX)] })]);
      expect(report(ok)).toEqual([]);
      expect(report(rubric([criterion({ name: "名".repeat(CRITERION_NAME_MAX + 1) })]))).toEqual([
        at(".criteria[0].name", "多すぎる(長い・大きい)値です"),
      ]);
      expect(report(rubric([criterion({ keywords: ["a", "語".repeat(KEYWORD_MAX + 1)] })]))).toEqual([
        at(".criteria[0].keywords[1]", "多すぎる(長い・大きい)値です"),
      ]);
    });

    it("全角半角・大文字小文字・空白をならすと空になるキーワード_止める", () => {
      for (const blank of ["", " ", "　", " \t\n　"]) {
        expect(report(rubric([criterion({ keywords: ["a", blank] })]))).toEqual([
          at(".criteria[0].keywords[1]", "ならすと空になるキーワードです"),
        ]);
      }
      expect(normalizeKeyword(" Ａ b　C ")).toBe("abc");
    });

    it("報告に、観点名やキーワードの値を載せない", () => {
      const marker = "目印XYZ";
      const r = rubric(
        [criterion({ name: marker.repeat(10), keywords: [marker.repeat(10)] }), criterion({ name: marker.repeat(10) })],
        999,
      );
      const errors = report(r);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).not.toContain(marker);
    });
  });

  it("選択式の問題に採点基準を付ける・未知の問題の種類_止める", () => {
    expect(messages(question(1, { rubric: freeText(1).rubric }))).not.toEqual([]);
    expect(messages(question(1, { questionType: "essay" }))).not.toEqual([]);
  });

  it("ファイル内の ID の重複・同じ設問文・資格コードの不一致を止める", () => {
    const m = (qs: unknown[]) => {
      const r = QuestionsFileSchema.safeParse(questionsFile(qs));
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(m([question(1), question(1, { questionText: "別の設問" })])).toContain("問題の ID が重複しています");
    expect(m([question(1), question(2, { questionText: "設問 1" })])).toContain("同じ設問文の問題があります");
    expect(m([question(1, { examCode: "EX-OTH-XX" })])).toContain("ファイルの資格コードと一致しません");
  });
});

describe("validateDataSet(ファイルをまたぐ検査)", () => {
  it("正しいデータを通す", () => {
    expect(validateDataSet(exams([published(), comingSoon()]), files())).toEqual([]);
  });

  it("問題の ID の接頭辞が、資格マスタの idPrefix と違う_問題の ID つきで場所を示す", () => {
    const errors = validateDataSet(
      exams(),
      files(questionsFile([question(1, { questionId: "OTHER-0001" }), question(2)])),
    );
    expect(errors).toEqual([
      "questions.ex-smp-xx.json: questions[0](OTHER-0001).questionId: ID の接頭辞が、資格マスタの idPrefix と一致しません",
    ]);
  });

  it("問題 ID の接頭辞が資格どうしで重複する・以前のコードが重複する_止める", () => {
    const second = published({ examCode: "EX-SM2-XX" });
    const dupPrefix = ExamsFileSchema.safeParse(exams([published(), second]));
    expect(dupPrefix.success ? [] : dupPrefix.error.issues.map((i) => i.message)).toContain(
      "問題 ID の接頭辞が重複しています",
    );
    const dupPrevious = ExamsFileSchema.safeParse(
      exams([published({ previousCodes: ["SAMPLE"] }), comingSoon({ previousCodes: ["SAMPLE"] })]),
    );
    expect(dupPrevious.success ? [] : dupPrevious.error.issues.map((i) => i.message)).toContain(
      "以前のコードが、ほかのコードと重複しています",
    );
  });

  it("試験コードの形_ベンダー略称-試験略称-版の形だけ(版がなければ XX)", () => {
    const ok = (code: string) => ExamsFileSchema.safeParse(exams([published({ examCode: code })])).success;
    expect(ok("AWS-AIB-C01")).toBe(true);
    expect(ok("EX-SMP-XX")).toBe(true);
    for (const bad of ["AIB", "AWS-AIB", "aws-aib-c01", "AWS_AIB_C01", "AWS-AIB-C", "AWS-AIB-C0001", "AWS-AIB-C01-X"]) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  describe("ベンダーの略称", () => {
    const vendors = { vendors: [{ name: "Example", abbr: "EX" }] };

    it("資格のベンダーの略称で始まるコード_通す", () => {
      expect(validateDataSet(exams(), files(), vendors)).toEqual([]);
    });

    it("コードの先頭がベンダーの略称と違う・ベンダーが一覧にない・一覧が無い_止める", () => {
      expect(validateDataSet(exams([published({ vendor: "Other" })]), files(), vendors)).toEqual([
        "exams.json: exams[0].vendor: vendors.json にないベンダーです",
      ]);
      expect(validateDataSet(exams(), files(), { vendors: [{ name: "Example", abbr: "AWS" }] })).toEqual([
        "exams.json: exams[0].examCode: コードの先頭が、ベンダーの略称と一致しません",
      ]);
      expect(validateDataSet(exams(), files(), null)).toEqual(["vendors.json: ファイルがありません"]);
    });

    it("ベンダーの名前・略称の重複_止める", () => {
      const dup = {
        vendors: [
          { name: "Example", abbr: "EX" },
          { name: "Example", abbr: "EX" },
        ],
      };
      expect(validateDataSet(exams(), files(), dup)).toHaveLength(2);
    });
  });

  it("資格マスタが無い・不正なとき", () => {
    expect(validateDataSet(null, [])).toEqual(["exams.json: ファイルがありません"]);
    expect(validateDataSet({}, [])[0]).toMatch(/^exams\.json: exams: /);
  });

  it("問題の分野が資格マスタにないとき、問題の ID つきで場所を示す", () => {
    const errors = validateDataSet(exams(), files(questionsFile([question(1, { domain: "domain9" }), question(2)])));
    expect(errors).toEqual(["questions.ex-smp-xx.json: questions[0](SAMPLE-0001).domain: 資格マスタにない分野です"]);
  });

  it("公開中の資格に問題データのファイルが無い・資格マスタにない資格のファイルがある", () => {
    expect(validateDataSet(exams(), [])[0]).toMatch(/questions\.ex-smp-xx\.json\)がありません/);
    const other = [
      {
        name: "questions.ex-oth-xx.json",
        data: { examCode: "EX-OTH-XX", questions: [question(1, { examCode: "EX-OTH-XX", questionId: "OTHER-0001" })] },
      },
    ];
    expect(validateDataSet(exams(), other)).toContain("questions.ex-oth-xx.json: 資格マスタにない資格の問題データです");
  });

  it("近日公開の資格に問題データがあるとき", () => {
    const data = {
      examCode: "EX-LTR-XX",
      questions: [question(1, { examCode: "EX-LTR-XX", questionId: "LATER-0001" })],
    };
    const errors = validateDataSet(exams([published(), comingSoon()]), [
      ...files(),
      { name: "questions.ex-ltr-xx.json", data },
    ]);
    expect(errors).toEqual(["questions.ex-ltr-xx.json: 公開中ではない資格(近日公開)に問題データがあります"]);
  });

  it("問題数が本番モードの出題数に足りないとき", () => {
    const errors = validateDataSet(exams([published({ officialQuestionCount: 3 })]), files());
    expect(errors).toEqual([
      "questions.ex-smp-xx.json: 選択式の問題数が、本番モードの出題数(officialQuestionCount)に足りません",
    ]);
  });

  it("本番モードの出題数_自由記述の問題は数えない", () => {
    const data = questionsFile([question(1), question(2), freeText(3)]);
    expect(validateDataSet(exams([published({ officialQuestionCount: 2 })]), files(data))).toEqual([]);
    expect(validateDataSet(exams([published({ officialQuestionCount: 3 })]), files(data))).toHaveLength(1);
  });

  it("ファイル名が不正・ファイル名のコードと examCode が違うとき", () => {
    expect(validateDataSet(exams(), [{ name: "questions.json", data: {} }])[0]).toMatch(/ファイル名が/);
    const mismatch = [
      {
        name: "questions.ex-smp-xx.json",
        data: { examCode: "EX-OTH-XX", questions: [question(1, { examCode: "EX-OTH-XX", questionId: "OTHER-0001" })] },
      },
    ];
    expect(validateDataSet(exams(), mismatch)).toContain(
      "questions.ex-smp-xx.json: examCode がファイル名のコードと一致しません",
    );
  });

  it("報告に、設問文や選択肢の本文を載せない", () => {
    const marker = "本文の目印XYZ";
    const q = question(1, {
      questionText: marker,
      choices: [
        { key: "A", text: marker },
        { key: "C", text: marker },
      ],
      correctAnswers: ["Q"],
    });
    const errors = validateDataSet(exams(), files(questionsFile([q])));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).not.toContain(marker);
  });
});
