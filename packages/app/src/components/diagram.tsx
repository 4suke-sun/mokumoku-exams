import type { CompareItemState, HierarchyNode } from "@mokumoku-exams/data-schema/curriculum-data/schema";
import {
  type AnyLayout,
  type BoxLayout,
  type Diagram,
  type DiagramLayout,
  LABEL_FONT_SIZE,
  layoutAny,
  type PlacedText,
} from "@/lib/diagram-layout.ts";

type Props = {
  diagram: Diagram;
  /** 図の要素の ID の接頭辞(読み上げの名前と説明を結びつける。ページの中で一意にする) */
  id: string;
  /** 狭い画面(`sm` 未満)では、比較の図を上下に積む(左右に並べると、文字が小さくなりすぎるため) */
  stackOnNarrow?: boolean;
};

/** 箱の題と説明を、読み上げ用に 1 つの文字にする */
const withNote = (label: string, note?: string) => (note ? `${label}(${note})` : label);

/** 比較の項目の状態の読み上げ */
const STATE_NAMES: Record<CompareItemState, string> = { removed: "消える", kept: "残る" };

function describeHierarchy(node: HierarchyNode): string {
  const children = node.children ?? [];
  if (children.length === 0) return "";
  const own = `「${node.label}」の中に${children.map((c) => `「${withNote(c.label, c.note)}」`).join("、")}。`;
  return own + children.map(describeHierarchy).join("");
}

/**
 * 読み上げ用の説明。種類ごとに、図の読み方を文にする。
 * - 流れ: 矢印ごとに「「A」から「B」へ(ラベル)。」
 * - 比較: 「左「見出し」: 項目、項目。右「見出し」: …」。状態のある項目は、後ろに「【消える】」「【残る】」を添える
 * - 階層: 親ごとに「「親」の中に「子」、「子」。」
 */
export function describeDiagram(diagram: Diagram): string {
  if (diagram.type === "compare") {
    const side = (name: string, s: typeof diagram.left) =>
      `${name}「${s.heading}」: ${s.items
        .map((i) => `${withNote(i.label, i.note)}${i.state ? `【${STATE_NAMES[i.state]}】` : ""}`)
        .join("、")}。`;
    return `${side("左", diagram.left)}${side("右", diagram.right)}`;
  }
  if (diagram.type === "hierarchy") {
    const root = diagram.root;
    return `「${withNote(root.label, root.note)}」。${describeHierarchy(root)}`;
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
};

/**
 * 比較の項目の状態ごとの色。消える項目は、ふだんの箱に、不正解の色の斜線を重ねる(文字は補助の色)。
 * 残る項目は、正解の面と太い枠で強調する。色だけでなく、斜線の形と、読み上げの説明でも伝える。
 */
const STATE_STYLES: Record<CompareItemState, { rect: string; label: string; note: string; strokeWidth: string }> = {
  removed: { rect: "fill-surface stroke-line", label: "fill-muted", note: "fill-muted", strokeWidth: "1.5" },
  kept: { rect: "fill-correct-bg stroke-correct", label: "fill-fg", note: "fill-correct", strokeWidth: "2.5" },
};

/** 消える項目の斜線の、箱の角からの内側の余白 */
const STRIKE_INSET = 6;

function BoxShapes({ layout }: { layout: BoxLayout }) {
  return (
    <>
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
 * 流れ・比較・階層の図。色はテーマの役割の色だけを使い、ライトとダークの両方で読めるようにする。
 * `stackOnNarrow` の比較の図は、左右に並べた図と、上下に積んだ図を描き、画面の幅で片方だけを出す(CSS の `sm`)。
 * 出さないほうは `display: none` なので、読み上げでも 1 つだけになる。
 */
export function DiagramView({ diagram, id, stackOnNarrow = false }: Props) {
  const stack = stackOnNarrow && diagram.type === "compare";
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
