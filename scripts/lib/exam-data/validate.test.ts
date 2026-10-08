import { describe, expect, it } from "vitest";
import { ExamsFileSchema, normalizeText, QuestionsFileSchema } from "./schema.ts";
import { validateDataSet } from "./validate.ts";

const published = (overrides: Record<string, unknown> = {}) => ({
  examCode: "SAMPLE",
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
  examCode: "LATER",
  status: "coming-soon",
  vendor: "Example",
  name: "近日公開の資格",
  shortName: "近日公開",
  ...overrides,
});

const question = (n: number, overrides: Record<string, unknown> = {}) => ({
  questionId: `SAMPLE-${String(n).padStart(4, "0")}`,
  examCode: "SAMPLE",
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

const questionsFile = (questions: unknown[] = [question(1), question(2)]) => ({ examCode: "SAMPLE", questions });
const exams = (list: unknown[] = [published()]) => ({ exams: list });
const files = (data: unknown = questionsFile()) => [{ name: "questions.sample.json", data }];

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

  it("資格のコードの重複を止める", () => {
    const r = ExamsFileSchema.safeParse(exams([published(), published()]));
    expect(r.success).toBe(false);
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

  it("ファイル内の ID の重複・同じ設問文・資格コードの不一致を止める", () => {
    const m = (qs: unknown[]) => {
      const r = QuestionsFileSchema.safeParse(questionsFile(qs));
      return r.success ? [] : r.error.issues.map((i) => i.message);
    };
    expect(m([question(1), question(1, { questionText: "別の設問" })])).toContain("問題の ID が重複しています");
    expect(m([question(1), question(2, { questionText: "設問 1" })])).toContain("同じ設問文の問題があります");
    expect(m([question(1, { examCode: "OTHER" })])).toContain("ファイルの資格コードと一致しません");
    expect(m([question(1, { questionId: "OTHER-0001" })])).toContain("ID の接頭辞が資格コードと一致しません");
  });
});

describe("validateDataSet(ファイルをまたぐ検査)", () => {
  it("正しいデータを通す", () => {
    expect(validateDataSet(exams([published(), comingSoon()]), files())).toEqual([]);
  });

  it("資格マスタが無い・不正なとき", () => {
    expect(validateDataSet(null, [])).toEqual(["exams.json: ファイルがありません"]);
    expect(validateDataSet({}, [])[0]).toMatch(/^exams\.json: exams: /);
  });

  it("問題の分野が資格マスタにないとき、問題の ID つきで場所を示す", () => {
    const errors = validateDataSet(exams(), files(questionsFile([question(1, { domain: "domain9" }), question(2)])));
    expect(errors).toEqual(["questions.sample.json: questions[0](SAMPLE-0001).domain: 資格マスタにない分野です"]);
  });

  it("公開中の資格に問題データのファイルが無い・資格マスタにない資格のファイルがある", () => {
    expect(validateDataSet(exams(), [])[0]).toMatch(/questions\.sample\.json\)がありません/);
    const other = [
      {
        name: "questions.other.json",
        data: { examCode: "OTHER", questions: [question(1, { examCode: "OTHER", questionId: "OTHER-0001" })] },
      },
    ];
    expect(validateDataSet(exams(), other)).toContain("questions.other.json: 資格マスタにない資格の問題データです");
  });

  it("近日公開の資格に問題データがあるとき", () => {
    const data = { examCode: "LATER", questions: [question(1, { examCode: "LATER", questionId: "LATER-0001" })] };
    const errors = validateDataSet(exams([published(), comingSoon()]), [
      ...files(),
      { name: "questions.later.json", data },
    ]);
    expect(errors).toEqual(["questions.later.json: 公開中ではない資格(近日公開)に問題データがあります"]);
  });

  it("問題数が本番モードの出題数に足りないとき", () => {
    const errors = validateDataSet(exams([published({ officialQuestionCount: 3 })]), files());
    expect(errors).toEqual(["questions.sample.json: 問題数が、本番モードの出題数(officialQuestionCount)に足りません"]);
  });

  it("ファイル名が不正・ファイル名のコードと examCode が違うとき", () => {
    expect(validateDataSet(exams(), [{ name: "questions.json", data: {} }])[0]).toMatch(/ファイル名が/);
    const mismatch = [
      {
        name: "questions.sample.json",
        data: { examCode: "OTHER", questions: [question(1, { examCode: "OTHER", questionId: "OTHER-0001" })] },
      },
    ];
    expect(validateDataSet(exams(), mismatch)).toContain(
      "questions.sample.json: examCode がファイル名のコードと一致しません",
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
