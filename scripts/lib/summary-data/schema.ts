/**
 * 要約カード(data/summary.<コード>.json)のスキーマ。形は docs/data-spec.md の「12. 要約カードのデータ」。
 * 直前チェックで 1 枚ずつ見返すためのデータで、問題ごとに、問いの要約・正解の選択肢・決め手を持つ。
 * 分野・難易度・選択肢の本文は問題から引くので、ここでは持たない。
 * 問題の存在と、正解との一致は、validate.ts で行う(問題データを読むため)。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";
import { prose } from "../exam-data/schema.ts";

const EXAM_CODE = /^[A-Z][A-Z0-9]{1,15}$/;
const QUESTION_ID = /^[A-Z][A-Z0-9]{1,15}-\d{4}$/;
const CHOICE_KEY = /^[A-Z]$/;

/** 要約カード: 問題 1 問につき 1 枚 */
export const SummaryCardSchema = z
  .strictObject({
    questionId: z.string().regex(QUESTION_ID),
    /** 問いの要約(1〜2 文)。カードの表に出す */
    question: prose.max(120),
    /** 正解の選択肢のキー。問題の `correctAnswers` と一致させる */
    answers: z.array(z.string().regex(CHOICE_KEY)).min(1).max(10),
    /** 決め手(答えを選ぶ理由。1〜2 文)。答えを開いたときに出す */
    point: prose.max(200),
  })
  .superRefine((card, ctx) => {
    if (new Set(card.answers).size !== card.answers.length) {
      ctx.addIssue({ code: "custom", path: ["answers"], message: "正解のキーが重複しています" });
    }
  });

export const SummaryFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    cards: z.array(SummaryCardSchema).min(1).max(500),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    file.cards.forEach((card, i) => {
      if (ids.has(card.questionId)) {
        ctx.addIssue({
          code: "custom",
          path: ["cards", i, "questionId"],
          message: "同じ問題の要約カードが重複しています",
        });
      }
      ids.add(card.questionId);
      if (!card.questionId.startsWith(`${file.examCode}-`)) {
        ctx.addIssue({
          code: "custom",
          path: ["cards", i, "questionId"],
          message: "問題の ID の接頭辞が資格コードと一致しません",
        });
      }
    });
  });

export type SummaryCard = z.infer<typeof SummaryCardSchema>;
export type SummaryFile = z.infer<typeof SummaryFileSchema>;
