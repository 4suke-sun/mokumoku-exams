/**
 * 体系ノート(data/notebook.<コード>.json)のスキーマ。形は docs/data-spec.md の「体系ノートのデータ」。
 * 本文は、問題データと同じ限定した記法(docs/data-spec.md の「文字の書き方」)で書く。
 * 項目の形と、1 つのファイルの中の整合(ID の一意、中分類と関連する見出しの参照)を、ここで検査する。
 * 分野のコードが資格マスタにあるかは、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";
import { DiagramSchema } from "../curriculum-data/schema.ts";
import { prose, ReferencesSchema } from "../exam-data/schema.ts";
import { EXAM_CODE } from "../exam-data/shape.ts";

const text = prose;

const DOMAIN_CODE = /^domain\d{1,2}$/;
/** 中分類の ID: `<分野のコード>-<分野の中の番号>`。URL の一部(`/exams/<資格コード>/notebook/<ID>`)になる */
const UNIT_ID = /^domain\d{1,2}-\d{1,2}$/;
/** 見出しの ID: 英小文字・数字・ハイフンで、英字から始める。ページの中の位置(`#<ID>`)になる */
const ENTRY_ID = /^[a-z][a-z0-9-]{0,63}$/;
const ENTRY_ID_MESSAGE = "ID は英小文字・数字・ハイフンで、英字から始めます";

/** 見出しの検証の状態。利用者に出すのは `verified` だけ(`unverified` は管理者のプレビューにだけ出す) */
export const NOTEBOOK_ENTRY_STATUSES = ["verified", "unverified"] as const;

/** 比較の表の 1 行: 観点と、列ごとの値。`highlight` の行は、取り違えやすい観点として目立たせる */
export const NotebookComparisonRowSchema = z.strictObject({
  aspect: text.max(40),
  cells: z.array(text.max(200)).min(2).max(4),
  highlight: z.boolean().optional(),
});

/** 比較の表: 取り違えやすい用語を、同じ観点で並べる。行の値の数は、列の数と同じ */
export const NotebookComparisonSchema = z
  .strictObject({
    columns: z.array(text.max(40)).min(2).max(4),
    rows: z.array(NotebookComparisonRowSchema).min(1).max(20),
  })
  .superRefine((comparison, ctx) => {
    comparison.rows.forEach((row, i) => {
      if (row.cells.length !== comparison.columns.length) {
        ctx.addIssue({ code: "custom", path: ["rows", i, "cells"], message: "値の数が列の数と違います" });
      }
    });
  });

/** 中分類: 試験ガイドの出題範囲の項目。見出しのない中分類も置く(目次に薄く出す) */
export const NotebookUnitSchema = z
  .strictObject({
    id: z.string().regex(UNIT_ID, "中分類の ID は <分野のコード>-<番号> の形にします"),
    /** 中分類が属する分野のコード(資格マスタの分野のコード) */
    domain: z.string().regex(DOMAIN_CODE),
    /** 分野の中の並び順(1 から) */
    order: z.int().positive().max(99),
    title: text.max(80),
    /** 導入の 1〜2 文 */
    intro: text.max(400).optional(),
    /** 中分類の冒頭の図(0〜1 個) */
    diagram: DiagramSchema.optional(),
    comparison: NotebookComparisonSchema.optional(),
  })
  .superRefine((unit, ctx) => {
    if (unit.id !== `${unit.domain}-${unit.order}`) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "中分類の ID が分野のコードと並び順に合いません" });
    }
  });

/** 確認の問い: 自己確認の問いと、答えと理由。結果は保存しない */
export const NotebookCheckSchema = z.strictObject({
  question: text.max(300),
  answer: text.max(500),
  reason: text.max(1000),
});

/** 見出し: 用語 1 つで 1 つ */
export const NotebookEntrySchema = z
  .strictObject({
    id: z.string().regex(ENTRY_ID, ENTRY_ID_MESSAGE),
    /** 見出しが属する中分類の ID */
    unit: z.string().regex(UNIT_ID),
    /** 中分類の中の並び順 */
    order: z.int().positive().max(999),
    term: text.max(60),
    /** 一言(1 文) */
    oneLine: text.max(200),
    /** 一言の中で、マーカーを引く箇所(一言の部分文字列) */
    keyPhrase: text.max(200).optional(),
    /** 解説 */
    body: text.max(10000),
    /** ここを押さえる(取り違えやすい点と、区別して覚える点。表示の名前は「ここを押さえる」) */
    examAngle: text.max(1000).optional(),
    checks: z.array(NotebookCheckSchema).min(1).max(10),
    /** 関連する見出しの ID */
    related: z.array(z.string().regex(ENTRY_ID, ENTRY_ID_MESSAGE)).min(1).max(10).optional(),
    /** 出典(公式の文書)。形と規則は問題の references と同じ */
    references: ReferencesSchema,
    status: z.enum(NOTEBOOK_ENTRY_STATUSES),
  })
  .superRefine((entry, ctx) => {
    if (entry.keyPhrase !== undefined && !entry.oneLine.includes(entry.keyPhrase)) {
      ctx.addIssue({ code: "custom", path: ["keyPhrase"], message: "一言(oneLine)の中にない文字列です" });
    }
    const related = new Set<string>();
    entry.related?.forEach((id, i) => {
      if (id === entry.id) {
        ctx.addIssue({ code: "custom", path: ["related", i], message: "自分自身は関連する見出しにできません" });
      }
      if (related.has(id)) {
        ctx.addIssue({ code: "custom", path: ["related", i], message: "関連する見出しの ID が重複しています" });
      }
      related.add(id);
    });
  });

export const NotebookFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    units: z.array(NotebookUnitSchema).min(1).max(200),
    entries: z.array(NotebookEntrySchema).max(2000),
  })
  .superRefine((file, ctx) => {
    const units = new Set<string>();
    file.units.forEach((unit, i) => {
      if (units.has(unit.id)) {
        ctx.addIssue({ code: "custom", path: ["units", i, "id"], message: "中分類の ID が重複しています" });
      }
      units.add(unit.id);
    });
    const entries = new Set(file.entries.map((entry) => entry.id));
    const seen = new Set<string>();
    const orders = new Set<string>();
    file.entries.forEach((entry, i) => {
      if (seen.has(entry.id)) {
        ctx.addIssue({ code: "custom", path: ["entries", i, "id"], message: "見出しの ID が重複しています" });
      }
      seen.add(entry.id);
      if (!units.has(entry.unit)) {
        ctx.addIssue({ code: "custom", path: ["entries", i, "unit"], message: "ファイルにない中分類です" });
      }
      const order = `${entry.unit}#${entry.order}`;
      if (orders.has(order)) {
        ctx.addIssue({
          code: "custom",
          path: ["entries", i, "order"],
          message: "中分類の中の並び順が重複しています",
        });
      }
      orders.add(order);
      entry.related?.forEach((id, j) => {
        if (!entries.has(id)) {
          ctx.addIssue({ code: "custom", path: ["entries", i, "related", j], message: "ファイルにない見出しです" });
        }
      });
    });
  });

export type NotebookComparison = z.infer<typeof NotebookComparisonSchema>;
export type NotebookUnit = z.infer<typeof NotebookUnitSchema>;
export type NotebookCheck = z.infer<typeof NotebookCheckSchema>;
export type NotebookEntry = z.infer<typeof NotebookEntrySchema>;
export type NotebookEntryStatus = (typeof NOTEBOOK_ENTRY_STATUSES)[number];
export type NotebookFile = z.infer<typeof NotebookFileSchema>;
