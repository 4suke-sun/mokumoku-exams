/**
 * 資格マスタ(data/exams.json)と問題データ(data/questions.<コード>.json)のスキーマ。
 * 仕様は docs/data-spec.md。項目の形と、1 つの問題の中の整合を、ここで検査する。
 * ファイルをまたぐ検査(分野がマスタにあるか、ファイルの有無)は、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";

/** 空白だけではない文字列。 */
const text = z.string().regex(/\S/, "空白だけの文字列です");

/** 本文の中の URL(`http://`・`https://`・`www.`)。出典の URL は、本文ではなく `references` に置く。 */
const URL_IN_TEXT = /https?:\/\/|www\./i;

/** 本文に URL を含むか。 */
export function containsUrl(value: string): boolean {
  return URL_IN_TEXT.test(value);
}

/** 本文: 空白だけではなく、URL を含まない文字列。 */
export const prose = text.refine((value) => !containsUrl(value), "本文に URL が含まれています");

const EXAM_CODE = /^[A-Z][A-Z0-9]{1,15}$/;
const DOMAIN_CODE = /^domain\d{1,2}$/;

/** 比較用に、全角・半角、空白の違いをならす。 */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

// ---- 資格マスタ ----

export const DomainSchema = z.strictObject({
  code: z.string().regex(DOMAIN_CODE),
  name: prose,
  weight: z.number().min(0).max(1),
});

const examBase = {
  examCode: z.string().regex(EXAM_CODE),
  vendor: prose,
  name: prose,
  shortName: prose,
};

/** 公開中の資格: 出題に必要な情報がすべてそろっている。 */
export const PublishedExamSchema = z
  .strictObject({
    ...examBase,
    status: z.literal("published"),
    edition: prose,
    category: prose,
    passingScore: z.number().positive(),
    totalScore: z.number().positive(),
    officialQuestionCount: z.int().positive(),
    officialTimeMinutes: z.int().positive(),
    domains: z.array(DomainSchema).min(1),
  })
  .superRefine((exam, ctx) => {
    if (exam.passingScore > exam.totalScore) {
      ctx.addIssue({ code: "custom", path: ["passingScore"], message: "合格点が満点を超えています" });
    }
    const codes = exam.domains.map((d) => d.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", path: ["domains"], message: "分野のコードが重複しています" });
    }
    const total = exam.domains.reduce((sum, d) => sum + d.weight, 0);
    if (Math.abs(total - 1) > 0.005) {
      ctx.addIssue({
        code: "custom",
        path: ["domains"],
        message: "分野の重みの合計が 1 ではありません(許容誤差 0.005)",
      });
    }
  });

/** 近日公開の資格: 一覧に表示するための最小限の情報だけを持つ。問題データは持たない。 */
export const ComingSoonExamSchema = z.strictObject({
  ...examBase,
  status: z.literal("coming-soon"),
  note: prose.optional(),
});

export const ExamSchema = z.discriminatedUnion("status", [PublishedExamSchema, ComingSoonExamSchema]);

export const ExamsFileSchema = z.strictObject({ exams: z.array(ExamSchema).min(1) }).superRefine((file, ctx) => {
  const seen = new Set<string>();
  file.exams.forEach((exam, i) => {
    if (seen.has(exam.examCode)) {
      ctx.addIssue({ code: "custom", path: ["exams", i, "examCode"], message: "資格のコードが重複しています" });
    }
    seen.add(exam.examCode);
  });
});

// ---- 問題データ ----

const ChoiceSchema = z.strictObject({
  key: z.string().regex(/^[A-Z]$/),
  text: prose,
  explanation: prose.optional(),
});

/**
 * 出典に使えるホスト名(完全一致)。公式ドキュメントだけを許す。
 * 資格を足すときは、そのベンダーの公式ドキュメントのホスト名を、ここに足す(docs/adding-an-exam.md)。
 */
export const ALLOWED_REFERENCE_HOSTS: readonly string[] = ["docs.aws.amazon.com", "aws.amazon.com", "www.nist.gov"];

/** 出典の題・URL の長さと、1 か所あたりの出典の数の上限 */
export const REFERENCE_TITLE_MAX = 200;
export const REFERENCE_URL_MAX = 2000;
export const REFERENCES_MAX = 10;

/**
 * 出典の URL の誤りの種類を返す(問題がなければ null)。返すのは固定の文言で、URL の値は含めない。
 * https で、ユーザー情報とポートを持たず、ホスト名が ALLOWED_REFERENCE_HOSTS にある URL だけを許す。
 */
export function referenceUrlProblem(value: string): string | null {
  if (!/^https:\/\/\S+$/.test(value)) return "https で始まる URL ではありません";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "URL の形ではありません";
  }
  if (url.username !== "" || url.password !== "") return "ユーザー情報付きの URL です";
  if (url.port !== "") return "ポート付きの URL です";
  if (!ALLOWED_REFERENCE_HOSTS.includes(url.hostname)) return "出典に許していないドメインの URL です";
  return null;
}

/** 出典: 公式ドキュメントへのリンク。題は任意(ないときは、画面にホスト名を出す)。 */
export const ReferenceSchema = z.strictObject({
  title: prose.max(REFERENCE_TITLE_MAX).optional(),
  url: z
    .string()
    .max(REFERENCE_URL_MAX)
    .superRefine((value, ctx) => {
      const problem = referenceUrlProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});

/** 出典の一覧: 1〜REFERENCES_MAX 件。同じ URL は重ねない。 */
export const ReferencesSchema = z
  .array(ReferenceSchema)
  .min(1)
  .max(REFERENCES_MAX)
  .superRefine((references, ctx) => {
    const seen = new Set<string>();
    references.forEach((reference, i) => {
      if (seen.has(reference.url)) {
        ctx.addIssue({ code: "custom", path: [i, "url"], message: "出典の URL が重複しています" });
      }
      seen.add(reference.url);
    });
  });

/** 問題の種類によらない項目 */
const questionBase = {
  questionId: z.string().regex(/^[A-Z][A-Z0-9]{1,15}-\d{4}$/),
  examCode: z.string().regex(EXAM_CODE),
  domain: z.string().regex(DOMAIN_CODE),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  questionText: prose,
  explanation: prose,
  supplement: prose.optional(),
  references: ReferencesSchema.optional(),
  tags: z.array(prose).optional(),
};

/** 択一・複数選択の問題 */
export const ChoiceQuestionSchema = z
  .strictObject({
    ...questionBase,
    questionType: z.enum(["single", "multiple"]),
    choices: z.array(ChoiceSchema).min(2).max(10),
    correctAnswers: z.array(z.string()).min(1),
  })
  .superRefine((q, ctx) => {
    const keys = q.choices.map((c) => c.key);
    const sequential = keys.every((key, i) => key === String.fromCharCode(65 + i));
    if (!sequential) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "選択肢のキーが A から連番になっていません" });
    }
    const answers = new Set(q.correctAnswers);
    if (answers.size !== q.correctAnswers.length) {
      ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "正解が重複しています" });
    }
    if (![...answers].every((a) => keys.includes(a))) {
      ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "正解が選択肢のキーにありません" });
    }
    if (q.questionType !== (answers.size === 1 ? "single" : "multiple")) {
      ctx.addIssue({ code: "custom", path: ["questionType"], message: "問題の種類が正解の数と一致しません" });
    }
    const texts = q.choices.map((c) => normalizeText(c.text));
    if (new Set(texts).size !== texts.length) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "同じ文言の選択肢があります" });
    }
  });

/** 観点名・キーワードの文字数の上限 */
export const CRITERION_NAME_MAX = 40;
export const KEYWORD_MAX = 40;

/**
 * キーワードとの照合のために、全角・半角、大文字・小文字の違いをならし、空白を除く。
 * 判定(packages/app/src/lib/free-text.ts の normalizeForMatch)と同じならし方にする。
 */
export function normalizeKeyword(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** キーワード。ならすと空になるものは、どの回答にも含まれず判定に使えないので、止める。 */
const KeywordSchema = z
  .string()
  .max(KEYWORD_MAX)
  .refine((value) => normalizeKeyword(value) !== "", "ならすと空になるキーワードです");

/** 採点基準の観点。キーワードのどれかを回答が含めば、観点を満たし、配点を得る。 */
const CriterionSchema = z.strictObject({
  name: prose.max(CRITERION_NAME_MAX),
  keywords: z.array(KeywordSchema).min(1),
  points: z.int().positive(),
});

/** 自由記述の採点基準。満たした観点の配点の合計が、合格点以上なら正解。 */
export const RubricSchema = z
  .strictObject({
    criteria: z.array(CriterionSchema).min(1),
    passingPoints: z.int().positive(),
  })
  .superRefine((rubric, ctx) => {
    const total = rubric.criteria.reduce((sum, c) => sum + c.points, 0);
    if (rubric.passingPoints > total) {
      ctx.addIssue({ code: "custom", path: ["passingPoints"], message: "合格点が配点の合計を超えています" });
    }
    // 画面で観点名をキーに使うため、空白と全角・半角の違いをならしても重複しないようにする
    const names = rubric.criteria.map((c) => normalizeText(c.name));
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", path: ["criteria"], message: "観点名が重複しています" });
    }
  });

/** 自由記述の問題。選択肢はなく、文章で答える。 */
export const FreeTextQuestionSchema = z.strictObject({
  ...questionBase,
  questionType: z.literal("free-text"),
  rubric: RubricSchema,
});

export const QuestionSchema = z.discriminatedUnion("questionType", [ChoiceQuestionSchema, FreeTextQuestionSchema]);

export const QuestionsFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    questions: z.array(QuestionSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    const stems = new Set<string>();
    file.questions.forEach((q, i) => {
      if (ids.has(q.questionId)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "questionId"], message: "問題の ID が重複しています" });
      }
      ids.add(q.questionId);
      if (q.examCode !== file.examCode) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "examCode"],
          message: "ファイルの資格コードと一致しません",
        });
      }
      if (!q.questionId.startsWith(`${file.examCode}-`)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "questionId"],
          message: "ID の接頭辞が資格コードと一致しません",
        });
      }
      const stem = normalizeText(q.questionText);
      if (stems.has(stem)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "questionText"], message: "同じ設問文の問題があります" });
      }
      stems.add(stem);
    });
  });

export type Reference = z.infer<typeof ReferenceSchema>;
export type Exam = z.infer<typeof ExamSchema>;
export type PublishedExam = z.infer<typeof PublishedExamSchema>;
export type ExamsFile = z.infer<typeof ExamsFileSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;
export type FreeTextQuestion = z.infer<typeof FreeTextQuestionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type QuestionsFile = z.infer<typeof QuestionsFileSchema>;
