/**
 * カリキュラム(data/curriculum.<コード>.json)のスキーマ。形は docs/data-spec.md の「カリキュラムのデータ」。
 * 本文は、問題データと同じ限定した記法(docs/data-spec.md の「文字の書き方」)で書く。
 * 項目の形と、1 つのファイルの中の整合を、ここで検査する。問題 ID が問題データにあるかは、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";

const text = z.string().regex(/\S/, "空白だけの文字列です");

const EXAM_CODE = /^[A-Z][A-Z0-9]{1,15}$/;
const QUESTION_ID = /^[A-Z][A-Z0-9]{1,15}-\d{4}$/;
/** 単元と節の ID。単元の ID は URL の一部(`/exams/<資格コード>/study/<単元の ID>`)になる */
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const ID_MESSAGE = "ID は英小文字・数字・ハイフンで、英字から始めます";

/** 節: 単元の本文の 1 区切り。 */
export const CurriculumSectionSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  title: text.max(80),
  body: text.max(10000),
});

/** 単元: 順に読む節と、関連する問題。 */
export const CurriculumUnitSchema = z
  .strictObject({
    id: z.string().regex(ID, ID_MESSAGE),
    title: text.max(80),
    /** 表示の順番。小さい順に並べる */
    order: z.int().positive(),
    sections: z.array(CurriculumSectionSchema).min(1).max(50),
    /** 「この単元の問題を解く」で出題する問題 */
    questionIds: z.array(z.string().regex(QUESTION_ID)).min(1).max(500),
  })
  .superRefine((unit, ctx) => {
    const sections = new Set<string>();
    unit.sections.forEach((section, i) => {
      if (sections.has(section.id)) {
        ctx.addIssue({ code: "custom", path: ["sections", i, "id"], message: "節の ID が重複しています" });
      }
      sections.add(section.id);
    });
    const questions = new Set<string>();
    unit.questionIds.forEach((id, i) => {
      if (questions.has(id)) {
        ctx.addIssue({ code: "custom", path: ["questionIds", i], message: "問題の ID が重複しています" });
      }
      questions.add(id);
    });
  });

export const CurriculumFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    units: z.array(CurriculumUnitSchema).min(1).max(100),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    file.units.forEach((unit, i) => {
      if (ids.has(unit.id)) {
        ctx.addIssue({ code: "custom", path: ["units", i, "id"], message: "単元の ID が重複しています" });
      }
      ids.add(unit.id);
      if (orders.has(unit.order)) {
        ctx.addIssue({ code: "custom", path: ["units", i, "order"], message: "単元の順番が重複しています" });
      }
      orders.add(unit.order);
      unit.questionIds.forEach((id, j) => {
        if (!id.startsWith(`${file.examCode}-`)) {
          ctx.addIssue({
            code: "custom",
            path: ["units", i, "questionIds", j],
            message: "問題の ID の接頭辞が資格コードと一致しません",
          });
        }
      });
    });
  });

export type CurriculumSection = z.infer<typeof CurriculumSectionSchema>;
export type CurriculumUnit = z.infer<typeof CurriculumUnitSchema>;
export type CurriculumFile = z.infer<typeof CurriculumFileSchema>;
