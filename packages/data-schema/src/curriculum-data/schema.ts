/**
 * カリキュラム(data/curriculum.<コード>.json)のスキーマ。形は docs/data-spec.md の「カリキュラムのデータ」。
 * 本文は、問題データと同じ限定した記法(docs/data-spec.md の「文字の書き方」)で書く。
 * 項目の形と、1 つのファイルの中の整合を、ここで検査する。問題 ID が問題データにあるかは、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";
import { prose, ReferencesSchema } from "../exam-data/schema.ts";
import { EXAM_CODE, QUESTION_ID } from "../exam-data/shape.ts";

/** 本文(題・本文・要約・図の文字)は、問題データと同じく、空白だけではなく URL を含まない文字列にする */
const text = prose;

/** 単元と節の ID。単元の ID は URL の一部(`/exams/<資格コード>/study/<単元の ID>`)になる */
const ID = /^[a-z][a-z0-9-]{0,31}$/;
const DOMAIN_CODE = /^domain\d{1,2}$/;
/** 単元の画面の経路(`/study/<ID>`)と重ならないよう、分野の画面の経路に使う語は、単元の ID にできない */
const RESERVED_UNIT_IDS = ["domains"];
const ID_MESSAGE = "ID は英小文字・数字・ハイフンで、英字から始めます";

/** 箱の題と、題の下に添える短い説明(任意) */
const BOX_LABEL = text.max(20);
const BOX_NOTE = text.max(40);

/** 流れの図の箱(ノード)。ID は辺の from / to で参照する */
export const DiagramNodeSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
  note: BOX_NOTE.optional(),
});

/** 図の矢印(辺)。from の箱から to の箱へ向かう。ラベルは任意 */
export const DiagramEdgeSchema = z.strictObject({
  from: z.string().regex(ID, ID_MESSAGE),
  to: z.string().regex(ID, ID_MESSAGE),
  label: text.max(12).optional(),
});

/**
 * 図の種類。流れ(箱と矢印)、左右の比較、入れ子の階層、時系列、表の変化(操作の前後)に、
 * 利用者の操作で動く 3 種類(手順を進める `stepper`、状態を切り替える `toggle`、条件を選んで進む `decision`)と、
 * データの粒が流れる `dataflow`(「再生」を押したときだけ動く)、積み上げた層の中身を開く `layers`。
 */
export const DIAGRAM_TYPES = [
  "flow",
  "compare",
  "hierarchy",
  "timeline",
  "table-change",
  "stepper",
  "toggle",
  "decision",
  "dataflow",
  "layers",
] as const;

/**
 * 流れの図: 箱と矢印の図。箱は、矢印の向きに沿って上から下へ段に並べて描く(packages/app/src/lib/diagram-layout.ts)。
 * 段に並べられるよう、矢印が一周して戻る形(閉路)と、自分自身への矢印は置けない。
 */
const FlowDiagramSchema = z
  .strictObject({
    type: z.literal("flow"),
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

/**
 * 比較の図の項目の状態(任意)。操作のあとに、その項目が消えるか(`removed`)、残るか(`kept`)。
 * 画面は、消える項目に斜線を引き、残る項目を強調する。状態のない項目は、ふだんの箱にする。
 */
export const COMPARE_ITEM_STATES = ["removed", "kept"] as const;

/** 比較の図の 1 項目(左右どちらかの側の箱) */
const CompareItemSchema = z.strictObject({
  label: BOX_LABEL,
  note: BOX_NOTE.optional(),
  state: z.enum(COMPARE_ITEM_STATES).optional(),
});

/** 比較の図の片側: 見出しと、上から順に並べる項目 */
const CompareSideSchema = z.strictObject({
  heading: BOX_LABEL,
  items: z.array(CompareItemSchema).min(1).max(6),
});

/** 比較の図: 左右 2 つの側を、見出しと項目で並べる。左右の項目は、同じ行どうしを対応させて並べる。 */
const CompareDiagramSchema = z.strictObject({
  type: z.literal("compare"),
  title: text.max(80),
  left: CompareSideSchema,
  right: CompareSideSchema,
});

/**
 * 階層の図の箱の状態(任意)。範囲が及ぶ起点の箱(`origin`。例: 権限を付けた箱)と、起点から範囲が及ぶ箱(`covered`)。
 * 画面は、起点を太い枠で、範囲内を正解の面で示す。状態のない箱は、ふだんの箱にする。
 */
export const HIERARCHY_NODE_STATES = ["origin", "covered"] as const;

/** 階層の図の箱。子の箱は、親の箱の中に入れ子にして描く */
export type HierarchyNode = {
  label: string;
  note?: string;
  state?: (typeof HIERARCHY_NODE_STATES)[number];
  children?: HierarchyNode[];
};

const HierarchyNodeSchema: z.ZodType<HierarchyNode> = z.lazy(() =>
  z.strictObject({
    label: BOX_LABEL,
    note: BOX_NOTE.optional(),
    state: z.enum(HIERARCHY_NODE_STATES).optional(),
    children: z.array(HierarchyNodeSchema).min(1).max(8).optional(),
  }),
);

/** 階層の図の入れ子の深さ(根を 1 とする)と、箱の数の上限 */
export const HIERARCHY_MAX_DEPTH = 4;
export const HIERARCHY_MAX_NODES = 25;

/** 階層の図: 根の箱の中に、子の箱を入れ子にして描く。 */
const HierarchyDiagramSchema = z
  .strictObject({
    type: z.literal("hierarchy"),
    title: text.max(80),
    root: HierarchyNodeSchema,
  })
  .superRefine((diagram, ctx) => {
    let count = 0;
    let deepest = 0;
    const walk = (node: HierarchyNode, depth: number) => {
      count += 1;
      deepest = Math.max(deepest, depth);
      for (const child of node.children ?? []) walk(child, depth + 1);
    };
    walk(diagram.root, 1);
    if (deepest > HIERARCHY_MAX_DEPTH) {
      ctx.addIssue({ code: "custom", path: ["root"], message: "入れ子が深すぎます" });
    }
    if (count > HIERARCHY_MAX_NODES) {
      ctx.addIssue({ code: "custom", path: ["root"], message: "階層の図の箱が多すぎます" });
    }
  });

/** 時系列の図の出来事。左から右(狭い画面では上から下)へ、時間の順に並べる */
const TimelineEventSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
  note: BOX_NOTE.optional(),
});

/** 時系列の図の期間: 出来事 `from` から出来事 `to` までの間に付ける名前(例: 戻せる期間) */
const TimelineSpanSchema = z.strictObject({
  from: z.string().regex(ID, ID_MESSAGE),
  to: z.string().regex(ID, ID_MESSAGE),
  label: text.max(16),
});

/** 時系列の図の出来事と期間の数の上限 */
export const TIMELINE_MAX_EVENTS = 6;
export const TIMELINE_MAX_SPANS = 3;

/**
 * 時系列の図: 出来事を時間の順(配列の順)に並べ、出来事の間の期間に名前を付ける。
 * 期間は、前の出来事から後の出来事へ向かい、期間どうしは重ならない(端の出来事は共有してよい)。並びが一意に決まる。
 */
const TimelineDiagramSchema = z
  .strictObject({
    type: z.literal("timeline"),
    title: text.max(80),
    events: z.array(TimelineEventSchema).min(2).max(TIMELINE_MAX_EVENTS),
    spans: z.array(TimelineSpanSchema).max(TIMELINE_MAX_SPANS).optional(),
  })
  .superRefine((diagram, ctx) => {
    const index = new Map<string, number>();
    diagram.events.forEach((event, i) => {
      if (index.has(event.id)) {
        ctx.addIssue({ code: "custom", path: ["events", i, "id"], message: "出来事の ID が重複しています" });
      }
      index.set(event.id, i);
    });
    const ranges: [number, number][] = [];
    diagram.spans?.forEach((span, i) => {
      const from = index.get(span.from);
      const to = index.get(span.to);
      if (from === undefined || to === undefined) {
        ctx.addIssue({ code: "custom", path: ["spans", i], message: "図にない出来事を指しています" });
        return;
      }
      if (from >= to) {
        ctx.addIssue({ code: "custom", path: ["spans", i], message: "期間は、前の出来事から後の出来事へ向けます" });
        return;
      }
      if (ranges.some(([a, b]) => from < b && a < to)) {
        ctx.addIssue({ code: "custom", path: ["spans", i], message: "期間どうしが重なっています" });
      }
      ranges.push([from, to]);
    });
  });

/**
 * 表の変化の図の状態(任意)。操作の前の表に置く `removed`(消した行)と、
 * 操作の後の表に置く `added`(足した行・列)・`changed`(値が変わった行)。
 */
export const TABLE_CHANGE_STATES = ["removed", "added", "changed"] as const;

const TABLE_CELL = text.max(12);

/** 表の変化の図の列。列を足す操作では、後の表の列に `added` を付ける */
const TableChangeColumnSchema = z.strictObject({
  label: TABLE_CELL,
  state: z.literal("added").optional(),
});

const TableChangeRowSchema = z.strictObject({
  cells: z.array(TABLE_CELL).min(1).max(4),
  state: z.enum(TABLE_CHANGE_STATES).optional(),
});

/** 表の変化の図の片側(操作の前か後の表) */
const TableChangeSideSchema = z.strictObject({
  heading: BOX_LABEL,
  columns: z.array(TableChangeColumnSchema).min(1).max(4),
  rows: z.array(TableChangeRowSchema).min(1).max(5),
});

/**
 * 表の変化の図: 操作の前の表と後の表を並べる。広い画面は、操作の名前を上に置き、前と後の表を左右に並べて矢印でつなぐ。
 * 狭い画面は、前の表、操作の名前と下向きの矢印、後の表の順に積む。
 * 消した行は前の表に、足した行・列と変わった行は後の表に、状態で示す。
 */
const TableChangeDiagramSchema = z
  .strictObject({
    type: z.literal("table-change"),
    title: text.max(80),
    /** 前の表から後の表への矢印に添える、操作の名前(例: `MERGE INTO`) */
    operation: BOX_LABEL,
    before: TableChangeSideSchema,
    after: TableChangeSideSchema,
  })
  .superRefine((diagram, ctx) => {
    for (const side of ["before", "after"] as const) {
      const table = diagram[side];
      table.rows.forEach((row, i) => {
        if (row.cells.length !== table.columns.length) {
          ctx.addIssue({ code: "custom", path: [side, "rows", i, "cells"], message: "値の数が列の数と違います" });
        }
        if (row.state && (side === "before") !== (row.state === "removed")) {
          ctx.addIssue({
            code: "custom",
            path: [side, "rows", i, "state"],
            message: "消した行は前の表に、足した行と変わった行は後の表に置きます",
          });
        }
      });
      if (side === "before") {
        table.columns.forEach((column, i) => {
          if (column.state) {
            ctx.addIssue({
              code: "custom",
              path: [side, "columns", i, "state"],
              message: "足した列は後の表に置きます",
            });
          }
        });
      }
    }
  });

/** 手順の図の段の数の上限と、段の説明の文字数の上限 */
export const STEPPER_MAX_STEPS = 8;
const STEP_NOTE = text.max(80);

/** 手順の図の 1 段。点灯したとき、`note`(その段の説明)がその場に出る */
const StepperStepSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
  note: STEP_NOTE.optional(),
});

/** 手順の図: 手順を上から順に並べ、利用者が 1 段ずつ点灯して進める(次へ・前へ・最初から)。 */
const StepperDiagramSchema = z
  .strictObject({
    type: z.literal("stepper"),
    title: text.max(80),
    steps: z.array(StepperStepSchema).min(2).max(STEPPER_MAX_STEPS),
  })
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>();
    diagram.steps.forEach((step, i) => {
      if (ids.has(step.id)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: "手順の ID が重複しています" });
      }
      ids.add(step.id);
    });
  });

/** 切り替えの図の状態(スイッチの 2 つの側)。ID は、項目の `result` で参照する */
const ToggleStateSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
});

/** 切り替えの図の項目の数の上限 */
export const TOGGLE_MAX_ITEMS = 8;

/**
 * 切り替えの図の項目。`result` は、状態の ID ごとに、その状態でこの項目が消えるか(`removed`)、残るか(`kept`)。
 * 状態の ID は、図の 2 つの状態をすべて、過不足なく書く。
 */
const ToggleItemSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
  note: BOX_NOTE.optional(),
  result: z.record(z.string().regex(ID, ID_MESSAGE), z.enum(COMPARE_ITEM_STATES)),
});

/** 切り替えの図: スイッチで 2 つの状態を切り替え、状態ごとに消える項目に斜線を引き、残る項目を強調する。 */
const ToggleDiagramSchema = z
  .strictObject({
    type: z.literal("toggle"),
    title: text.max(80),
    states: z.tuple([ToggleStateSchema, ToggleStateSchema]),
    items: z.array(ToggleItemSchema).min(1).max(TOGGLE_MAX_ITEMS),
  })
  .superRefine((diagram, ctx) => {
    const [first, second] = diagram.states;
    if (first.id === second.id) {
      ctx.addIssue({ code: "custom", path: ["states", 1, "id"], message: "状態の ID が重複しています" });
    }
    const stateIds = new Set(diagram.states.map((state) => state.id));
    const ids = new Set<string>();
    diagram.items.forEach((item, i) => {
      if (ids.has(item.id)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "id"], message: "項目の ID が重複しています" });
      }
      ids.add(item.id);
      for (const key of Object.keys(item.result)) {
        if (!stateIds.has(key)) {
          ctx.addIssue({ code: "custom", path: ["items", i, "result"], message: "図にない状態を指しています" });
          break;
        }
      }
      for (const id of stateIds) {
        if (!(id in item.result)) {
          ctx.addIssue({ code: "custom", path: ["items", i, "result"], message: "状態ごとの結果がそろっていません" });
          break;
        }
      }
    });
  });

/** 判断の図の選択肢。選ぶと、`to` の節(質問か結論)へ進む */
const DecisionChoiceSchema = z.strictObject({
  label: BOX_LABEL,
  to: z.string().regex(ID, ID_MESSAGE),
});

/** 判断の図の質問の節 */
const DecisionQuestionSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  question: text.max(60),
  choices: z.array(DecisionChoiceSchema).min(2).max(4),
});

/** 判断の図の結論の節(行き止まり) */
const DecisionResultSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  result: text.max(60),
  note: STEP_NOTE.optional(),
});

/** 判断の図の節の数の上限 */
export const DECISION_MAX_NODES = 12;

/** 判断の図の節(質問か結論)。質問は `question` と `choices`、結論は `result` を持つ */
export type DecisionNode = z.infer<typeof DecisionQuestionSchema> | z.infer<typeof DecisionResultSchema>;

/**
 * 判断の図: 質問と選択肢の木。先頭の節が最初の質問で、選択肢を選んで結論まで進む。
 * 矢印が一周して戻る形(閉路)と、先頭の節から行き着けない節は置けない。結論は 1 つ以上要る。
 */
const DecisionDiagramSchema = z
  .strictObject({
    type: z.literal("decision"),
    title: text.max(80),
    nodes: z
      .array(z.union([DecisionQuestionSchema, DecisionResultSchema]))
      .min(2)
      .max(DECISION_MAX_NODES),
  })
  .superRefine((diagram, ctx) => {
    // 参照の誤りがあるときは、閉路と到達の検査を省く(誤りの報告を重ねない)
    let valid = true;
    const ids = new Set<string>();
    diagram.nodes.forEach((node, i) => {
      if (ids.has(node.id)) {
        valid = false;
        ctx.addIssue({ code: "custom", path: ["nodes", i, "id"], message: "判断の節の ID が重複しています" });
      }
      ids.add(node.id);
    });
    const edges: { from: string; to: string }[] = [];
    diagram.nodes.forEach((node, i) => {
      if (!("choices" in node)) return;
      node.choices.forEach((choice, j) => {
        if (!ids.has(choice.to)) {
          valid = false;
          ctx.addIssue({ code: "custom", path: ["nodes", i, "choices", j, "to"], message: "図にない節を指しています" });
        } else if (choice.to === node.id) {
          valid = false;
          ctx.addIssue({ code: "custom", path: ["nodes", i, "choices", j], message: "自分自身へは進めません" });
        }
        edges.push({ from: node.id, to: choice.to });
      });
    });
    if (!diagram.nodes.some((node) => "result" in node)) {
      ctx.addIssue({ code: "custom", path: ["nodes"], message: "結論の節が 1 つもありません" });
    }
    if (!valid) return;
    if (hasCycle(diagram.nodes, edges)) {
      ctx.addIssue({ code: "custom", path: ["nodes"], message: "選択肢が一周して戻る形(閉路)になっています" });
      return;
    }
    const reached = new Set<string>();
    const queue = [diagram.nodes[0]?.id];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (reached.has(id)) continue;
      reached.add(id);
      for (const edge of edges) if (edge.from === id) queue.push(edge.to);
    }
    diagram.nodes.forEach((node, i) => {
      if (!reached.has(node.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["nodes", i],
          message: "先頭の節から行き着けない節があります",
        });
      }
    });
  });

/** データの流れの図の箱の数・矢印の数の上限 */
export const DATAFLOW_MAX_NODES = 8;
export const DATAFLOW_MAX_EDGES = 16;

/** データの流れの図の箱。`filter: true` の箱では、流れてきた粒の一部が落ちる(絞り込み) */
const DataflowNodeSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
  note: BOX_NOTE.optional(),
  filter: z.boolean().optional(),
});

const DataflowEdgeSchema = z.strictObject({
  from: z.string().regex(ID, ID_MESSAGE),
  to: z.string().regex(ID, ID_MESSAGE),
});

/**
 * データの流れの図: 箱と矢印を上から下へ並べ、「再生」で粒が箱から箱へ流れる。
 * 矢印が一周して戻る形(閉路)と、自分自身への矢印は置けない(流れの図と同じ)。
 */
const DataflowDiagramSchema = z
  .strictObject({
    type: z.literal("dataflow"),
    title: text.max(80),
    nodes: z.array(DataflowNodeSchema).min(2).max(DATAFLOW_MAX_NODES),
    edges: z.array(DataflowEdgeSchema).min(1).max(DATAFLOW_MAX_EDGES),
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

/** 層の図の層の数の上限と、層の中身(語句)の数の上限 */
export const LAYERS_MAX_LAYERS = 6;
export const LAYERS_MAX_ITEMS = 8;

/** 層の図の 1 層。選ぶと、`items`(中身の語句)と `note` が開く */
const LayerSchema = z.strictObject({
  id: z.string().regex(ID, ID_MESSAGE),
  label: BOX_LABEL,
  note: STEP_NOTE.optional(),
  items: z.array(BOX_LABEL).min(1).max(LAYERS_MAX_ITEMS).optional(),
});

/** 層の図: 層を下から積み、層を選ぶと中身が開く。`layers` の先頭が、いちばん下の層。 */
const LayersDiagramSchema = z
  .strictObject({
    type: z.literal("layers"),
    title: text.max(80),
    layers: z.array(LayerSchema).min(2).max(LAYERS_MAX_LAYERS),
  })
  .superRefine((diagram, ctx) => {
    const ids = new Set<string>();
    diagram.layers.forEach((layer, i) => {
      if (ids.has(layer.id)) {
        ctx.addIssue({ code: "custom", path: ["layers", i, "id"], message: "層の ID が重複しています" });
      }
      ids.add(layer.id);
    });
  });

/**
 * 図解: `type` で 10 種類(`flow`・`compare`・`hierarchy`・`timeline`・`table-change`・`stepper`・`toggle`・`decision`・`dataflow`・`layers`)を分ける判別ユニオン。
 * `type` のない図は、流れの図として読む(`type` は省略できる)。
 */
export const DiagramSchema = z.preprocess(
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !("type" in value)
      ? { type: "flow", ...value }
      : value,
  z.discriminatedUnion("type", [
    FlowDiagramSchema,
    CompareDiagramSchema,
    HierarchyDiagramSchema,
    TimelineDiagramSchema,
    TableChangeDiagramSchema,
    StepperDiagramSchema,
    ToggleDiagramSchema,
    DecisionDiagramSchema,
    DataflowDiagramSchema,
    LayersDiagramSchema,
  ]),
);

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
    /** 単元が属する分野のコード(資格マスタの分野のコード。ファイルの `domains` にもある) */
    domain: z.string().regex(DOMAIN_CODE),
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
    if (RESERVED_UNIT_IDS.includes(unit.id)) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "この ID は、画面の経路に使うため使えません" });
    }
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

/** 分野の説明: 学習モードの分野の一覧に出す。分野の名前は、資格マスタ(`data/exams.json`)の分野の名前を使う */
export const CurriculumDomainSchema = z.strictObject({
  /** 資格マスタの分野のコード */
  code: z.string().regex(DOMAIN_CODE),
  /** 分野の説明(短い文章) */
  summary: text.max(200),
});

export const CurriculumFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    /** 分野の説明。単元が属する分野を、すべて書く。表示の順は、資格マスタの分野の並び */
    domains: z.array(CurriculumDomainSchema).min(1).max(20),
    units: z.array(CurriculumUnitSchema).min(1).max(100),
  })
  .superRefine((file, ctx) => {
    const domains = new Set<string>();
    file.domains.forEach((domain, i) => {
      if (domains.has(domain.code)) {
        ctx.addIssue({ code: "custom", path: ["domains", i, "code"], message: "分野のコードが重複しています" });
      }
      domains.add(domain.code);
    });
    const used = new Set<string>();
    file.units.forEach((unit, i) => {
      used.add(unit.domain);
      if (!domains.has(unit.domain)) {
        ctx.addIssue({
          code: "custom",
          path: ["units", i, "domain"],
          message: "分野の説明(domains)にない分野です",
        });
      }
    });
    file.domains.forEach((domain, i) => {
      if (!used.has(domain.code)) {
        ctx.addIssue({ code: "custom", path: ["domains", i], message: "この分野の単元がありません" });
      }
    });
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
    });
  });

export type Diagram = z.infer<typeof DiagramSchema>;
export type FlowDiagram = Extract<Diagram, { type: "flow" }>;
export type CompareDiagram = Extract<Diagram, { type: "compare" }>;
export type HierarchyDiagram = Extract<Diagram, { type: "hierarchy" }>;
export type TimelineDiagram = Extract<Diagram, { type: "timeline" }>;
export type TableChangeDiagram = Extract<Diagram, { type: "table-change" }>;
export type StepperDiagram = Extract<Diagram, { type: "stepper" }>;
export type ToggleDiagram = Extract<Diagram, { type: "toggle" }>;
export type DecisionDiagram = Extract<Diagram, { type: "decision" }>;
export type DataflowDiagram = Extract<Diagram, { type: "dataflow" }>;
export type LayersDiagram = Extract<Diagram, { type: "layers" }>;
export type CompareItemState = (typeof COMPARE_ITEM_STATES)[number];
export type HierarchyNodeState = (typeof HIERARCHY_NODE_STATES)[number];
export type TableChangeState = (typeof TABLE_CHANGE_STATES)[number];
export type CurriculumDomain = z.infer<typeof CurriculumDomainSchema>;
export type CurriculumSection = z.infer<typeof CurriculumSectionSchema>;
export type CurriculumStage = z.infer<typeof CurriculumStageSchema>;
export type CurriculumUnit = z.infer<typeof CurriculumUnitSchema>;
export type CurriculumFile = z.infer<typeof CurriculumFileSchema>;
