/**
 * 資格マスタ(data/exams.json)と問題データ(data/questions.<コード>.json)のスキーマ。
 * 仕様は docs/data-spec.md。項目の形と、1 つの問題の中の整合を、ここで検査する。
 * ファイルをまたぐ検査(分野がマスタにあるか、ファイルの有無)は、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";
import { EXAM_CODE, normalizeKeyword, QUESTION_ID } from "./shape.ts";

export { EXAM_CODE, normalizeKeyword, QUESTION_ID };

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

/** 問題 ID の接頭辞。試験コードとは別に持ち、資格どうしで重複しない(問題 ID は `<接頭辞>-<4 桁の連番>`) */
export const ID_PREFIX = /^[A-Z][A-Z0-9]{1,15}$/;
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

/**
 * 資格のレベル(段階)。一覧で、ベンダーの中の公開中・近日公開のそれぞれを、この順に並べる(上が易しい)。
 * `category`(区分)は、資格の領域を表す自由な文字列で、レベルとは別の項目。
 */
export const EXAM_LEVELS = ["Foundational", "Associate", "Professional", "Expert", "Specialty"] as const;

const examBase = {
  examCode: z.string().regex(EXAM_CODE),
  vendor: prose,
  name: prose,
  shortName: prose,
  /** 資格のレベル。公式にレベルの区分がない資格は、持たない */
  level: z.enum(EXAM_LEVELS).optional(),
  /** 以前の試験コード(旧コードの URL を新しいコードへ転送し、保存済みのデータを移すために使う) */
  previousCodes: z
    .array(z.string().regex(/^[A-Z][A-Z0-9]{1,15}$/))
    .max(5)
    .optional(),
  /** 一覧のタイルに出す短い表記(英数字 1〜4 文字) */
  abbr: z
    .string()
    .regex(/^[A-Za-z0-9]{1,4}$/)
    .optional(),
};

/** 日付(`YYYY-MM-DD`)。実在する日だけ */
const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
  }, "実在しない日付です");

/**
 * 資格の情報(情報ページに出す項目)。どれも公式の情報だけに基づく。`checkedAt` は、公式の情報を確認した日。
 * 公式に載っていない項目は、持たない(画面は、持たない項目を出さない)。
 */
export const ExamInfoSchema = z.strictObject({
  checkedAt: DATE,
  /** 出題形式(例: 択一選択式と複数選択式) */
  format: prose.max(80).optional(),
  /** 受験できる言語 */
  languages: z.array(prose.max(20)).min(1).max(10).optional(),
  /** 受験料。`note` は、価格の補足(ベータ価格など) */
  fee: z
    .strictObject({
      amount: z.number().positive().max(1_000_000),
      currency: z.string().regex(/^[A-Z]{3}$/),
      note: prose.max(80).optional(),
    })
    .optional(),
  /** 認定の有効期間(年) */
  validityYears: z.int().min(1).max(10).optional(),
  /** この版の試験を受験できる最終日。公式に告知されている資格だけが持つ */
  lastExamDate: DATE.optional(),
  /** 公式の試験ガイドの URL。出典と同じく、許したドメインの https の URL だけ */
  guideUrl: z
    .string()
    .max(2000)
    .superRefine((value, ctx) => {
      const problem = referenceUrlProblem(value);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    })
    .optional(),
});

/** 分野のコードの重複と、重みの合計(1。許容誤差 0.005)を検査する。公開中と、分野を持つ準備中の資格で共通 */
function checkDomains(domains: readonly { code: string; weight: number }[], ctx: z.RefinementCtx): void {
  const codes = domains.map((d) => d.code);
  if (new Set(codes).size !== codes.length) {
    ctx.addIssue({ code: "custom", path: ["domains"], message: "分野のコードが重複しています" });
  }
  const total = domains.reduce((sum, d) => sum + d.weight, 0);
  if (Math.abs(total - 1) > 0.005) {
    ctx.addIssue({
      code: "custom",
      path: ["domains"],
      message: "分野の重みの合計が 1 ではありません(許容誤差 0.005)",
    });
  }
}

/** 公開中の資格: 出題に必要な情報がすべてそろっている。 */
export const PublishedExamSchema = z
  .strictObject({
    ...examBase,
    status: z.literal("published"),
    /** 問題 ID の接頭辞(問題 ID は `<接頭辞>-<4 桁の連番>`)。資格どうしで重複しない */
    idPrefix: z.string().regex(ID_PREFIX),
    /** 退役した問題 ID(削除した問題の ID)。再び使わない。採番は、これも含めた最大の番号の次から */
    retiredQuestionIds: z.array(z.string().regex(QUESTION_ID)).optional(),
    edition: prose,
    category: prose,
    passingScore: z.number().positive(),
    totalScore: z.number().positive(),
    officialQuestionCount: z.int().positive(),
    officialTimeMinutes: z.int().positive(),
    /** ベータ試験の期間中の資格だけが持つ。本番の値(出題数・制限時間など)は、ベータ試験のもの */
    beta: z.literal(true).optional(),
    domains: z.array(DomainSchema).min(1),
    info: ExamInfoSchema.optional(),
  })
  .superRefine((exam, ctx) => {
    if (exam.passingScore > exam.totalScore) {
      ctx.addIssue({ code: "custom", path: ["passingScore"], message: "合格点が満点を超えています" });
    }
    checkDomains(exam.domains, ctx);
  });

/**
 * 近日公開の資格: 一覧に表示するための最小限の情報を持つ。問題データ・`info`・カリキュラム・要約カードは持たない。
 * 問題を作る前に作問パイプラインへ通すために、版・分野・本番の出題数・問題 ID の接頭辞を、任意の項目として持てる
 * (形は公開中の資格と同じ。アプリの一覧は、これらを使わない)。
 */
export const ComingSoonExamSchema = z
  .strictObject({
    ...examBase,
    status: z.literal("coming-soon"),
    note: prose.optional(),
    edition: prose.optional(),
    officialQuestionCount: z.int().positive().optional(),
    idPrefix: z.string().regex(ID_PREFIX).optional(),
    domains: z.array(DomainSchema).min(1).optional(),
  })
  .superRefine((exam, ctx) => {
    if (exam.domains !== undefined) checkDomains(exam.domains, ctx);
  });

/** ベンダーの略称の一覧(`data/vendors.json`)。資格の試験コードの先頭は、資格のベンダーの略称と一致する */
export const VendorsFileSchema = z
  .strictObject({
    vendors: z.array(z.strictObject({ name: prose, abbr: z.string().regex(/^[A-Z][A-Z0-9]{1,5}$/) })).min(1),
  })
  .superRefine((file, ctx) => {
    for (const key of ["name", "abbr"] as const) {
      const values = file.vendors.map((v) => v[key]);
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: "custom",
          path: ["vendors"],
          message: `ベンダーの${key === "name" ? "名前" : "略称"}が重複しています`,
        });
      }
    }
  });

export const ExamSchema = z.discriminatedUnion("status", [PublishedExamSchema, ComingSoonExamSchema]);

export const ExamsFileSchema = z.strictObject({ exams: z.array(ExamSchema).min(1) }).superRefine((file, ctx) => {
  const seen = new Set<string>();
  file.exams.forEach((exam, i) => {
    if (seen.has(exam.examCode)) {
      ctx.addIssue({ code: "custom", path: ["exams", i, "examCode"], message: "資格のコードが重複しています" });
    }
    seen.add(exam.examCode);
    for (const old of exam.previousCodes ?? []) {
      if (old === exam.examCode || seen.has(old)) {
        ctx.addIssue({
          code: "custom",
          path: ["exams", i, "previousCodes"],
          message: "以前のコードが、ほかのコードと重複しています",
        });
      }
      seen.add(old);
    }
  });
  const prefixes = new Set<string>();
  file.exams.forEach((exam, i) => {
    // 公開中と準備中をまたいで、接頭辞の重複を検査する
    if (exam.idPrefix === undefined) return;
    if (prefixes.has(exam.idPrefix)) {
      ctx.addIssue({ code: "custom", path: ["exams", i, "idPrefix"], message: "問題 ID の接頭辞が重複しています" });
    }
    prefixes.add(exam.idPrefix);
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
export const ALLOWED_REFERENCE_HOSTS: readonly string[] = [
  "docs.aws.amazon.com",
  "aws.amazon.com",
  "www.nist.gov",
  "docs.databricks.com",
  "www.databricks.com",
  "spark.apache.org",
];

/** 出典の題・URL の長さと、1 か所あたりの出典の数の上限 */
export const REFERENCE_TITLE_MAX = 200;
export const REFERENCE_URL_MAX = 2000;
export const REFERENCES_MAX = 10;

/**
 * 出典のホストごとに、そのホストを出典にしてよい資格のベンダー(`data/vendors.json` の name)。
 * キーは ALLOWED_REFERENCE_HOSTS と同じ集合にする(検査で確かめる)。
 * ベンダー自身のホストに加え、そのベンダーの試験ガイドが参照する公的な機関のホストも、ここで対応づける。
 */
export const REFERENCE_HOST_VENDORS: Readonly<Record<string, readonly string[]>> = {
  "docs.aws.amazon.com": ["AWS"],
  "aws.amazon.com": ["AWS"],
  "www.nist.gov": ["AWS"],
  "docs.databricks.com": ["Databricks"],
  "www.databricks.com": ["Databricks"],
  "spark.apache.org": ["Databricks"],
};

/** 出典の URL を落とす理由のコード。値は含めない */
export type SourceUrlReason =
  | "not-https"
  | "malformed"
  | "userinfo"
  | "port"
  | "query"
  | "fragment"
  | "host-not-allowed";

const SOURCE_URL_MESSAGES: Record<SourceUrlReason, string> = {
  "not-https": "https で始まる URL ではありません",
  malformed: "URL の形ではありません",
  userinfo: "ユーザー情報付きの URL です",
  port: "ポート付きの URL です",
  query: "クエリ文字列(?…)付きの URL です",
  fragment: "フラグメント(#…)付きの URL です",
  "host-not-allowed": "出典に許していないドメインの URL です",
};

/**
 * 出典の URL を落とす理由のコードを返す(問題がなければ null)。
 * https で、ユーザー情報・ポート・クエリ文字列・フラグメントを持たず、ホスト名が ALLOWED_REFERENCE_HOSTS に完全一致する URL だけを許す。
 * 出典は資料のページを指せば足りる。クエリとフラグメントは、署名や利用者を識別する値を運びうるので許さない。
 * 空の `?` や `#` は、URL の解釈では空文字列になって見逃すので、解釈の前の文字列で確かめる。
 * ホスト名は URL の解釈で小文字になり、既定のポート(443)は取り除かれる。末尾のドットや、似せたホスト名は一致しない。
 */
export function sourceUrlReason(value: string): SourceUrlReason | null {
  if (!/^https:\/\/\S+$/.test(value)) return "not-https";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "malformed";
  }
  if (url.protocol !== "https:") return "not-https";
  if (url.username !== "" || url.password !== "") return "userinfo";
  if (url.port !== "") return "port";
  if (value.includes("?")) return "query";
  if (value.includes("#")) return "fragment";
  if (!ALLOWED_REFERENCE_HOSTS.includes(url.hostname)) return "host-not-allowed";
  return null;
}

/** 出典の URL の誤りの種類を、固定の文言で返す(問題がなければ null)。URL の値は含めない */
export function referenceUrlProblem(value: string): string | null {
  const reason = sourceUrlReason(value);
  return reason === null ? null : SOURCE_URL_MESSAGES[reason];
}

/** その資格のベンダーが、このホストを出典にしてよいか。許可していないホストは false */
export function hostAllowedForVendor(host: string, vendor: string): boolean {
  return REFERENCE_HOST_VENDORS[host]?.includes(vendor) ?? false;
}

/** 出典の題: 空白だけではなく、URL を含まず、REFERENCE_TITLE_MAX 文字以内。 */
export const ReferenceTitle = prose.max(REFERENCE_TITLE_MAX);

/** 出典: 公式ドキュメントへのリンク。題は任意(ないときは、画面にホスト名を出す)。 */
export const ReferenceSchema = z.strictObject({
  title: ReferenceTitle.optional(),
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
  questionId: z.string().regex(QUESTION_ID),
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
      const stem = normalizeText(q.questionText);
      if (stems.has(stem)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "questionText"], message: "同じ設問文の問題があります" });
      }
      stems.add(stem);
    });
  });

/** 非公開にした問題の判定。書き直して公開に戻せるものと、戻せないもの */
export const UNPUBLISH_VERDICTS = ["rewritable", "unpublish"] as const;

/** 非公開にした理由の記録(`<段階>:<コード>`。例: 判定の段階の理由コード) */
export const UNPUBLISH_REASON = /^[a-z]+:[a-z]+(?:-[a-z]+)*$/;

/** 非公開の 1 件。問題の本文はそのまま持ち、判定と理由を添える(公開に戻すときは、`question` をそのまま公開のファイルへ移す) */
export const UnpublishedEntrySchema = z.strictObject({
  verdict: z.enum(UNPUBLISH_VERDICTS),
  reasons: z.array(z.string().regex(UNPUBLISH_REASON)).min(1).max(10),
  question: QuestionSchema,
});

/**
 * 非公開の問題のファイル(data/unpublished.<コード>.json)。アプリは読まず、配信に含まれない(docs/data-spec.md の「13. 非公開の問題」)。
 * ファイル名を `questions.` で始めないのは、アプリの読み込みと、問題データの検査が `questions.*.json` を対象にするため。
 */
export const UnpublishedFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    entries: z.array(UnpublishedEntrySchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    file.entries.forEach((entry, i) => {
      const q = entry.question;
      if (ids.has(q.questionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "question", "questionId"],
          message: "問題の ID が重複しています",
        });
      }
      ids.add(q.questionId);
      if (q.examCode !== file.examCode) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "question", "examCode"],
          message: "ファイルの資格コードと一致しません",
        });
      }
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
export type UnpublishedEntry = z.infer<typeof UnpublishedEntrySchema>;
export type UnpublishedFile = z.infer<typeof UnpublishedFileSchema>;
