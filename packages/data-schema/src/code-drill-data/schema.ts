/**
 * コードドリル(data/code-drill.<コード>.json)のスキーマ。形は docs/data-spec.md の「15. コードドリルのデータ」。
 * 項目の形と、1 つの問題の中の整合(穴と正解、断片の数、別解の重なり)を、ここで検査する。
 * 分野のコードと問題 ID の接頭辞が資格マスタにあるかは、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";
import { DiagramSchema } from "../curriculum-data/schema.ts";
import { prose, ReferencesSchema } from "../exam-data/schema.ts";
import { EXAM_CODE } from "../exam-data/shape.ts";
import { normalizeCode } from "./normalize.ts";

/** 問題 ID: `<問題 ID の接頭辞>-CD-<4 桁>`。演習の問題の ID(`<接頭辞>-<4 桁>`)と重ならない */
export const CODE_DRILL_ID = /^[A-Z][A-Z0-9]{1,15}-CD-\d{4}$/;
const DOMAIN_CODE = /^domain\d{1,2}$/;

export const CODE_DRILL_LANGUAGES = ["sql", "pyspark"] as const;
export const CODE_DRILL_STATUSES = ["verified", "unverified"] as const;
/** 実行するとどうなるか: エラーになる / 結果が変わる / 結果は同じだが要件を満たさない */
export const OUTCOME_KINDS = ["error", "different-result", "same-result"] as const;

/** 穴の印。`{{1}}` から始まる連番 */
const PLACEHOLDER = /\{\{(\d+)\}\}/g;
/** 1 問の断片(正解と誤り)の数の上限 */
export const MAX_FRAGMENTS = 12;

/** コード(空白だけは不可)。コードはそのまま表示するだけで、本文の記法は解釈しない */
const code = z.string().regex(/\S/, "空白だけの文字列です");

export const CodeDrillOutcomeSchema = z.strictObject({
  kind: z.enum(OUTCOME_KINDS),
  text: prose.max(400),
  diagram: DiagramSchema.optional(),
});

/** 正解のコードを実行した結果 */
export const CodeDrillResultSchema = z.strictObject({
  text: prose.max(400),
  diagram: DiagramSchema.optional(),
});

export const CodeDrillProblemSchema = z
  .strictObject({
    id: z.string().regex(CODE_DRILL_ID, "問題 ID は <接頭辞>-CD-<4 桁> の形にします"),
    domain: z.string().regex(DOMAIN_CODE),
    language: z.enum(CODE_DRILL_LANGUAGES),
    title: prose.max(60),
    /** 問いと要件(本文の記法: `**太字**`、`` `コード` ``) */
    prompt: prose.max(600),
    /** 穴のあるコード。穴は `{{1}}`、`{{2}}` … */
    template: code.max(2000),
    blanks: z
      .array(z.strictObject({ answer: code.max(200) }))
      .min(1)
      .max(6),
    distractors: z
      .array(z.strictObject({ text: code.max(200), blank: z.int().positive(), outcome: CodeDrillOutcomeSchema }))
      .max(10),
    /** 全文入力で正解にするコード。先頭は、穴に正解を入れたもの。2 つ目からは別解 */
    solutions: z.array(code.max(3000)).min(1).max(5),
    /** 全文入力のよくある誤り(任意) */
    mistakes: z
      .array(z.strictObject({ code: code.max(3000), outcome: CodeDrillOutcomeSchema }))
      .max(5)
      .optional(),
    result: CodeDrillResultSchema,
    explanation: prose.max(1000),
    references: ReferencesSchema,
    status: z.enum(CODE_DRILL_STATUSES),
  })
  .superRefine((problem, ctx) => {
    const numbers = [...problem.template.matchAll(PLACEHOLDER)].map((m) => Number(m[1]));
    const expected = problem.blanks.map((_, i) => i + 1);
    if (numbers.length !== expected.length || numbers.some((n, i) => n !== expected[i])) {
      ctx.addIssue({ code: "custom", path: ["template"], message: "穴の番号が 1 からの連番で、穴の数と一致しません" });
    } else {
      const filled = problem.template.replace(PLACEHOLDER, (_, n) => problem.blanks[Number(n) - 1]?.answer ?? "");
      if (filled !== problem.solutions[0]) {
        ctx.addIssue({ code: "custom", path: ["solutions", 0], message: "穴に正解を入れたコードと一致しません" });
      }
    }
    problem.distractors.forEach((distractor, i) => {
      const target = problem.blanks[distractor.blank - 1];
      if (!target) {
        ctx.addIssue({ code: "custom", path: ["distractors", i, "blank"], message: "ない穴の番号です" });
      } else if (target.answer === distractor.text) {
        ctx.addIssue({ code: "custom", path: ["distractors", i, "text"], message: "その穴の正解と同じ断片です" });
      }
    });
    const fragments = problem.blanks.length + problem.distractors.length;
    if (fragments < problem.blanks.length + 2 || fragments > MAX_FRAGMENTS) {
      ctx.addIssue({
        code: "custom",
        path: ["distractors"],
        message: "断片の数が、穴の数 + 2 以上、12 以下ではありません",
      });
    }
    const normalized = problem.solutions.map((s) => normalizeCode(problem.language, s));
    normalized.forEach((value, i) => {
      if (normalized.indexOf(value) !== i) {
        ctx.addIssue({ code: "custom", path: ["solutions", i], message: "別解が、正解か別の別解と同じです" });
      }
    });
    problem.mistakes?.forEach((mistake, i) => {
      if (normalized.includes(normalizeCode(problem.language, mistake.code))) {
        ctx.addIssue({
          code: "custom",
          path: ["mistakes", i, "code"],
          message: "よくある誤りが、正解か別解と同じです",
        });
      }
    });
  });

export const CodeDrillFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    problems: z.array(CodeDrillProblemSchema).min(1).max(500),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.problems.forEach((problem, i) => {
      if (seen.has(problem.id)) {
        ctx.addIssue({ code: "custom", path: ["problems", i, "id"], message: "問題 ID が重複しています" });
      }
      seen.add(problem.id);
    });
  });

export type CodeDrillOutcome = z.infer<typeof CodeDrillOutcomeSchema>;
export type CodeDrillProblem = z.infer<typeof CodeDrillProblemSchema>;
export type CodeDrillFile = z.infer<typeof CodeDrillFileSchema>;
export type CodeDrillLanguage = (typeof CODE_DRILL_LANGUAGES)[number];
