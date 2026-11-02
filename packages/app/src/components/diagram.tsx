import type { HierarchyNode, TableChangeDiagram } from "@mokumoku-exams/data-schema/curriculum-data/schema";
import {
  type AnyLayout,
  type BoxLayout,
  type BoxState,
  type Diagram,
  type DiagramLayout,
  LABEL_FONT_SIZE,
  layoutAny,
  type PlacedText,
  STACKABLE_TYPES,
} from "@/lib/diagram-layout.ts";

type Props = {
  diagram: Diagram;
  /** 図の要素の ID の接頭辞(読み上げの名前と説明を結びつける。ページの中で一意にする) */
  id: string;
  /** 狭い画面(`sm` 未満)では、比較・時系列・表の変化の図を上下に積む(左右に並べると、文字が小さくなりすぎるため) */
  stackOnNarrow?: boolean;
};

/** 箱の題と説明を、読み上げ用に 1 つの文字にする */
const withNote = (label: string, note?: string) => (note ? `${label}(${note})` : label);

/** 箱の状態の読み上げ(比較の項目、階層の箱、表の変化の行と列) */
const STATE_NAMES: Record<BoxState, string> = {
  removed: "消える",
  kept: "残る",
  origin: "起点",
  covered: "範囲内",
  added: "足した",
  changed: "変わった",
};
/** 表の変化の図では、消える行を「消した」と読む(操作のあとの結果として) */
const TABLE_STATE_NAMES: Record<BoxState, string> = { ...STATE_NAMES, removed: "消した" };

const mark = (state: BoxState | undefined, names = STATE_NAMES) => (state ? `【${names[state]}】` : "");

function describeHierarchy(node: HierarchyNode): string {
  const children = node.children ?? [];
  if (children.length === 0) return "";
  const own = `「${node.label}」の中に${children
    .map((c) => `「${withNote(c.label, c.note)}」${mark(c.state)}`)
    .join("、")}。`;
  return own + children.map(describeHierarchy).join("");
}

function describeTable(name: string, table: TableChangeDiagram["before"]): string {
  const columns = table.columns.map((c) => `${c.label}${mark(c.state, TABLE_STATE_NAMES)}`).join("、");
  const rows = table.rows.map((r) => `${r.cells.join("、")}${mark(r.state, TABLE_STATE_NAMES)}`).join("。");
  return `${name}「${table.heading}」: 列は${columns}。行は${rows}。`;
}

/**
 * 読み上げ用の説明。種類ごとに、図の読み方を文にする。
 * - 流れ: 矢印ごとに「「A」から「B」へ(ラベル)。」
 * - 比較: 「左「見出し」: 項目、項目。右「見出し」: …」。状態のある項目は、後ろに「【消える】」「【残る】」を添える
 * - 階層: 親ごとに「「親」の中に「子」、「子」。」。状態のある箱は、後ろに「【起点】」「【範囲内】」を添える
 * - 時系列: 「時間の順に「A」、「B」。」のあと、期間ごとに「「A」から「B」まで: 期間の名前。」
 * - 表の変化: 「操作「名前」の前と後。」のあと、前と後の表ごとに、列と行。状態のある行と列は「【消した】」などを添える
 */
export function describeDiagram(diagram: Diagram): string {
  if (diagram.type === "compare") {
    const side = (name: string, s: typeof diagram.left) =>
      `${name}「${s.heading}」: ${s.items.map((i) => `${withNote(i.label, i.note)}${mark(i.state)}`).join("、")}。`;
    return `${side("左", diagram.left)}${side("右", diagram.right)}`;
  }
  if (diagram.type === "hierarchy") {
    const root = diagram.root;
    return `「${withNote(root.label, root.note)}」${mark(root.state)}。${describeHierarchy(root)}`;
  }
  if (diagram.type === "timeline") {
    const labels = new Map(diagram.events.map((event) => [event.id, event.label]));
    const events = `時間の順に${diagram.events.map((e) => `「${withNote(e.label, e.note)}」`).join("、")}。`;
    const spans = (diagram.spans ?? [])
      .map((span) => `「${labels.get(span.from) ?? ""}」から「${labels.get(span.to) ?? ""}」まで: ${span.label}。`)
      .join("");
    return events + spans;
  }
  if (diagram.type === "table-change") {
    return `操作「${diagram.operation}」の前と後。${describeTable("前", diagram.before)}${describeTable("後", diagram.after)}`;
  }
  const labels = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  return diagram.edges
    .map((edge) => {
      const text = `「${labels.get(edge.from) ?? ""}」から「${labels.get(edge.to) ?? ""}」へ`;
      return `${edge.label ? `${text}(${edge.label})` : text}。`;
    })
    .join("");
}

/** 箱の中の文字。題は本文の色、説明は補助の色(箱の面の上で読める組み合わせ) */
function Texts({ texts, labelClass, noteClass }: { texts: PlacedText[]; labelClass: string; noteClass: string }) {
  return texts.map((t) => (
    <text
      // 同じ文字の行が並んでも区別できるよう、位置を鍵にする(並びは変わらない)
      key={`${t.y}-${t.text}`}
      x={t.x}
      y={t.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={t.fontSize}
      fontWeight={t.role === "note" ? undefined : 700}
      className={t.role === "note" ? noteClass : labelClass}
    >
      {t.text}
    </text>
  ));
}

function FlowShapes({ layout }: { layout: DiagramLayout }) {
  return (
    <>
      {layout.edges.map((edge) => (
        <g key={`${edge.from}>${edge.to}`}>
          <line
            x1={edge.start.x}
            y1={edge.start.y}
            x2={edge.end.x}
            y2={edge.end.y}
            strokeWidth="1.5"
            className="stroke-muted"
          />
          <polygon points={edge.arrow.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-muted" />
        </g>
      ))}
      {layout.edges.map((edge) =>
        edge.label && edge.labelBox ? (
          <g key={`${edge.from}>${edge.to}-label`}>
            <rect {...edge.labelBox} rx="4" className="fill-surface stroke-line" />
            <text
              x={edge.labelBox.x + edge.labelBox.width / 2}
              y={edge.labelBox.y + edge.labelBox.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={LABEL_FONT_SIZE}
              className="fill-muted"
            >
              {edge.label}
            </text>
          </g>
        ) : null,
      )}
      {layout.nodes.map((node) => (
        <g key={node.id}>
          <rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rx="6"
            strokeWidth="1.5"
            className="fill-surface stroke-primary"
          />
          <Texts texts={node.texts} labelClass="fill-fg" noteClass="fill-muted" />
        </g>
      ))}
    </>
  );
}

/** 比較・階層の箱の色。色の組は、面と文字がテーマの役割の色どうし(ライトとダーク、リッチとシンプルで同じ組) */
const BOX_STYLES: Record<BoxLayout["boxes"][number]["tone"], { rect: string; label: string; note: string }> = {
  "heading-left": { rect: "fill-violet-soft stroke-violet", label: "fill-violet", note: "fill-violet" },
  "heading-right": { rect: "fill-orange-soft stroke-orange", label: "fill-orange", note: "fill-orange" },
  item: { rect: "fill-surface stroke-line", label: "fill-fg", note: "fill-muted" },
  "depth-0": { rect: "fill-soft stroke-primary", label: "fill-primary", note: "fill-primary" },
  "depth-1": { rect: "fill-surface stroke-violet", label: "fill-fg", note: "fill-muted" },
  "depth-2": { rect: "fill-orange-soft stroke-orange", label: "fill-orange", note: "fill-orange" },
  "depth-3": { rect: "fill-bg stroke-line", label: "fill-fg", note: "fill-muted" },
  event: { rect: "fill-surface stroke-primary", label: "fill-fg", note: "fill-muted" },
  span: { rect: "fill-soft stroke-primary", label: "fill-primary", note: "fill-primary" },
  operation: { rect: "fill-surface stroke-muted", label: "fill-fg", note: "fill-muted" },
  "cell-header": { rect: "fill-bg stroke-line", label: "fill-fg", note: "fill-muted" },
  cell: { rect: "fill-surface stroke-line", label: "fill-fg", note: "fill-muted" },
};

/**
 * 箱の状態ごとの色。消える(消した)箱は、ふだんの箱に、不正解の色の斜線を重ねる(文字は補助の色)。
 * 残る箱、足した行・列、範囲内の箱は、正解の面で強調する(残る・足したは太い枠も)。変わった行は注意の面にする。
 * 起点の箱は、主要な操作の色の太い枠にする。色だけでなく、斜線と枠の形と、読み上げの説明でも伝える。
 */
const STATE_STYLES: Record<BoxState, { rect: string; label: string; note: string; strokeWidth: string }> = {
  removed: { rect: "fill-surface stroke-line", label: "fill-muted", note: "fill-muted", strokeWidth: "1.5" },
  kept: { rect: "fill-correct-bg stroke-correct", label: "fill-fg", note: "fill-correct", strokeWidth: "2.5" },
  added: { rect: "fill-correct-bg stroke-correct", label: "fill-fg", note: "fill-correct", strokeWidth: "2.5" },
  changed: { rect: "fill-warn-bg stroke-warn", label: "fill-fg", note: "fill-warn", strokeWidth: "2" },
  origin: { rect: "fill-soft stroke-primary", label: "fill-primary", note: "fill-primary", strokeWidth: "3" },
  covered: { rect: "fill-correct-bg stroke-correct", label: "fill-fg", note: "fill-correct", strokeWidth: "1.5" },
};

/** 消える項目の斜線の、箱の角からの内側の余白 */
const STRIKE_INSET = 6;

function BoxShapes({ layout }: { layout: BoxLayout }) {
  return (
    <>
      {layout.connectors?.map((line) => (
        <g key={`${line.start.x},${line.start.y}>${line.end.x},${line.end.y}`}>
          <line
            x1={line.start.x}
            y1={line.start.y}
            x2={line.end.x}
            y2={line.end.y}
            strokeWidth="1.5"
            className="stroke-muted"
          />
          {line.arrow ? (
            <polygon points={line.arrow.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-muted" />
          ) : null}
        </g>
      ))}
      {layout.boxes.map((box) => {
        const style = box.state ? STATE_STYLES[box.state] : { ...BOX_STYLES[box.tone], strokeWidth: "1.5" };
        return (
          <g key={`${box.x}-${box.y}`} data-state={box.state}>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx="6"
              strokeWidth={style.strokeWidth}
              className={style.rect}
            />
            <Texts texts={box.texts} labelClass={style.label} noteClass={style.note} />
            {box.state === "removed" ? (
              <line
                x1={box.x + STRIKE_INSET}
                y1={box.y + STRIKE_INSET}
                x2={box.x + box.width - STRIKE_INSET}
                y2={box.y + box.height - STRIKE_INSET}
                strokeWidth="2"
                strokeLinecap="round"
                // 線の長さを 1 とみなし、引かれる動き(.motion-strike)を、長さによらず同じ書き方にする
                pathLength={1}
                className="motion-strike stroke-incorrect"
              />
            ) : null}
          </g>
        );
      })}
      {layout.versus ? (
        <text
          x={layout.versus.x}
          y={layout.versus.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={12}
          fontWeight={700}
          className="fill-muted"
        >
          vs
        </text>
      ) : null}
    </>
  );
}

function Shapes({ layout }: { layout: AnyLayout }) {
  return layout.kind === "flow" ? <FlowShapes layout={layout} /> : <BoxShapes layout={layout} />;
}

/** 図の本体(SVG)。読み上げの名前は図の題、説明は describeDiagram */
function DiagramSvg({ diagram, id, stacked, className }: Props & { stacked: boolean; className: string }) {
  const layout = layoutAny(diagram, { stacked });
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descId}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      width={layout.width}
      height={layout.height}
      // 幅の狭い画面では縮めて、横にはみ出さないようにする(広い画面では、元の大きさより広げない)
      className={["mx-auto h-auto w-full", className].filter(Boolean).join(" ")}
      style={{ maxWidth: layout.width }}
      data-diagram-type={diagram.type}
      data-stacked={stacked ? "true" : undefined}
    >
      <title id={titleId}>{diagram.title}</title>
      <desc id={descId}>{describeDiagram(diagram)}</desc>
      <Shapes layout={layout} />
    </svg>
  );
}

/**
 * 流れ・比較・階層・時系列・表の変化の図。色はテーマの役割の色だけを使い、ライトとダークの両方で読めるようにする。
 * 体系ノートなど、特定の画面に依存しない(どの画面からも使える)。
 * `stackOnNarrow` の比較・時系列・表の変化の図は、左右に並べた図と、上下に積んだ図を描き、画面の幅で片方だけを出す(CSS の `sm`)。
 * 出さないほうは `display: none` なので、読み上げでも 1 つだけになる。
 */
export function DiagramView({ diagram, id, stackOnNarrow = false }: Props) {
  const stack = stackOnNarrow && STACKABLE_TYPES.includes(diagram.type);
  return (
    <figure className="space-y-2">
      {stack ? (
        <>
          <DiagramSvg diagram={diagram} id={`${id}-stacked`} stacked className="sm:hidden" />
          <DiagramSvg diagram={diagram} id={id} stacked={false} className="hidden sm:block" />
        </>
      ) : (
        <DiagramSvg diagram={diagram} id={id} stacked={false} className="" />
      )}
      {/* 読み上げでは、図の名前(title)で伝わるので、見出しを重ねて読ませない */}
      <figcaption aria-hidden="true" className="text-sm text-muted">
        {diagram.title}
      </figcaption>
    </figure>
  );
}
