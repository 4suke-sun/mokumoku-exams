/**
 * カリキュラム(data/curriculum.<コード>.json)のスキーマ。形は docs/data-spec.md の「カリキュラムのデータ」。
 * 本文は、問題データと同じ限定した記法(docs/data-spec.md の「文字の書き方」)で書く。
 * 項目の形と、1 つのファイルの中の整合を、ここで検査する。問題 ID が問題データにあるかは、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";
import { prose, ReferencesSchema } from "../exam-data/schema.ts";

/** 本文(題・本文・要約・図の文字)は、問題データと同じく、空白だけではなく URL を含まない文字列にする */
const text = prose;

const EXAM_CODE = /^[A-Z][A-Z0-9]{1,15}$/;
const QUESTION_ID = /^[A-Z][A-Z0-9]{1,15}-\d{4}$/;
/** 単元と節の ID。単元の ID は URL の一部(`/exams/<資格コード>/study/<単元の ID>`)になる */
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const ID_MESSAGE = "ID は英小文字・数字・ハイフンで、英字から始めます";

/** 図の箱(ノード)。ID は辺の from / to で参照する */
export const DiagramNodeSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: text.max(20),
});

/** 図の矢印(辺)。from の箱から to の箱へ向かう。ラベルは任意 */
export const DiagramEdgeSchema = z.strictObject({
  from: z.string().regex(ID, ID_MESSAGE),
  to: z.string().regex(ID, ID_MESSAGE),
  label: text.max(12).optional(),
});

/**
 * 図解: 箱と矢印の図。箱は、矢印の向きに沿って上から下へ段に並べて描く(packages/app/src/lib/diagram-layout.ts)。
 * 段に並べられるよう、矢印が一周して戻る形(閉路)と、自分自身への矢印は置けない。
 */
export const DiagramSchema = z
  .strictObject({
    /** 図の題。画面の見出しと、読み上げの名前になる */
    title: text.max(80),
    nodes: z.array(DiagramNodeSchema).min(2).max(20),
    edges: z.array(DiagramEdgeSchema).min(1).max(40),
  })
  .superRefine((diagram, ctx) => {
    // 参照の誤りがあるときは、閉路の検査を省く(誤りの報告を重ねない)
    let valid = true;
    const nodes = new Set<string>();
    diagram.nodes.forEach((node, i) => {
      if (nodes.has(node.id)) {
        valid = false;
        ctx.addIssue({ code: "custom", path: ["nodes", i, "id"], message: "図の箱の ID が重複しています" });
      }
      nodes.add(node.id);
    });
    const pairs = new Set<string>();
    diagram.edges.forEach((edge, i) => {
      for (const end of ["from", "to"] as const) {
        if (!nodes.has(edge[end])) {
          valid = false;
          ctx.addIssue({ code: "custom", path: ["edges", i, end], message: "図にない箱を指しています" });
        }
      }
      if (edge.from === edge.to) {
        valid = false;
        ctx.addIssue({ code: "custom", path: ["edges", i], message: "自分自身への矢印は置けません" });
      }
      const pair = `${edge.from}>${edge.to}`;
      if (pairs.has(pair)) {
        ctx.addIssue({ code: "custom", path: ["edges", i], message: "同じ向きの矢印が重複しています" });
      }
      pairs.add(pair);
    });
    if (valid && hasCycle(diagram.nodes, diagram.edges)) {
      ctx.addIssue({ code: "custom", path: ["edges"], message: "矢印が一周して戻る形(閉路)になっています" });
    }
  });

/** 矢印をたどって元の箱に戻れる形があるか(入ってくる矢印のない箱から順に取り除き、残りがあれば閉路) */
function hasCycle(nodes: readonly { id: string }[], edges: readonly { from: string; to: string }[]): boolean {
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  let removed = 0;
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    removed += 1;
    for (const edge of edges) {
      if (edge.from !== id) continue;
      const rest = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, rest);
      if (rest === 0) queue.push(edge.to);
    }
  }
  return removed < indegree.size;
}

/** 節: 単元の本文の 1 区切り。図解と出典は任意で、本文のあとに出す */
export const CurriculumSectionSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  title: text.max(80),
  body: text.max(10000),
  diagram: DiagramSchema.optional(),
  /** 節の出典(公式ドキュメント)。形と規則は問題の references と同じ */
  references: ReferencesSchema.optional(),
});

/** 段階: 単元の中で順に積み上げる区切り。確認問題に合格すると、次の段階へ進める。 */
export const CurriculumStageSchema = z.strictObject({
  /** 段階の順番。小さい順に進む */
  order: z.int().positive().max(100),
  /** 段階の確認問題(この順に出題する) */
  questionIds: z.array(z.string().regex(QUESTION_ID)).min(1).max(100),
});

/** 単元: 順に読む節と、関連する問題。要約と段階は任意。 */
export const CurriculumUnitSchema = z
  .strictObject({
    id: z.string().regex(ID, ID_MESSAGE),
    title: text.max(80),
    /** 表示の順番。小さい順に並べる */
    order: z.int().positive(),
    /** 単元の要約(短い箇条書き。1 項目が 1 行) */
    summary: z.array(text.max(200)).min(1).max(10).optional(),
    sections: z.array(CurriculumSectionSchema).min(1).max(50),
    /** 「この単元の問題を解く」で出題する問題 */
    questionIds: z.array(z.string().regex(QUESTION_ID)).min(1).max(500),
    stages: z.array(CurriculumStageSchema).min(1).max(20).optional(),
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
    const stageOrders = new Set<number>();
    unit.stages?.forEach((stage, i) => {
      if (stageOrders.has(stage.order)) {
        ctx.addIssue({ code: "custom", path: ["stages", i, "order"], message: "段階の順番が重複しています" });
      }
      stageOrders.add(stage.order);
      const stageQuestions = new Set<string>();
      stage.questionIds.forEach((id, j) => {
        if (stageQuestions.has(id)) {
          ctx.addIssue({
            code: "custom",
            path: ["stages", i, "questionIds", j],
            message: "問題の ID が重複しています",
          });
        }
        stageQuestions.add(id);
      });
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
      unit.stages?.forEach((stage, k) => {
        stage.questionIds.forEach((id, j) => {
          if (!id.startsWith(`${file.examCode}-`)) {
            ctx.addIssue({
              code: "custom",
              path: ["units", i, "stages", k, "questionIds", j],
              message: "問題の ID の接頭辞が資格コードと一致しません",
            });
          }
        });
      });
    });
  });

export type Diagram = z.infer<typeof DiagramSchema>;
export type CurriculumSection = z.infer<typeof CurriculumSectionSchema>;
export type CurriculumStage = z.infer<typeof CurriculumStageSchema>;
export type CurriculumUnit = z.infer<typeof CurriculumUnitSchema>;
export type CurriculumFile = z.infer<typeof CurriculumFileSchema>;
