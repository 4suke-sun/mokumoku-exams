"use client";

import type {
  DataflowDiagram,
  DecisionDiagram,
  HierarchyNode,
  LayersDiagram,
  StepperDiagram,
  TableChangeDiagram,
  ToggleDiagram,
} from "@mokumoku-exams/data-schema/curriculum-data/schema";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  type AnyLayout,
  type BoxLayout,
  type BoxState,
  type Diagram,
  type DiagramLayout,
  LABEL_FONT_SIZE,
  layoutAny,
  type PlacedText,
  planDataflow,
  STACKABLE_TYPES,
  type StaticDiagram,
} from "@/lib/diagram-layout.ts";
import { usePrefersReducedMotion, useVisualStyle } from "@/lib/use-visual-style.ts";
import { effectsEnabled } from "@/lib/visual-style.ts";

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
 * - 手順: 「手順の図。順に「A(説明)」、「B」。」
 * - 切り替え: 「2 つの状態「X」と「Y」を切り替える。」のあと、状態ごとに、項目と「【残る】」「【消える】」
 * - 判断: 質問ごとに「質問「Q」: 「選択肢」なら「行き先」へ。」、結論ごとに「結論「R(説明)」。」
 * - データの流れ: 矢印ごとに「「A」から「B」へ。」のあと、絞り込みの箱ごとに「「X」は絞り込みで、粒の一部が落ちる。」
 * - 層: 「層の図。下から順に「A」、「B」。」のあと、中身のある層ごとに「「A」の中身: 語句、語句。」
 */
export function describeDiagram(diagram: Diagram): string {
  if (diagram.type === "dataflow") {
    const labels = new Map(diagram.nodes.map((n) => [n.id, n.label]));
    const edges = diagram.edges
      .map((e) => `「${labels.get(e.from) ?? ""}」から「${labels.get(e.to) ?? ""}」へ。`)
      .join("");
    const filters = diagram.nodes
      .filter((n) => n.filter)
      .map((n) => `「${n.label}」は絞り込みで、粒の一部が落ちる。`)
      .join("");
    const notes = diagram.nodes
      .filter((n) => n.note)
      .map((n) => `「${n.label}」: ${n.note}。`)
      .join("");
    return `データの流れの図。${edges}${filters}${notes}`;
  }
  if (diagram.type === "layers") {
    const contents = diagram.layers
      .filter((l) => l.items || l.note)
      .map((l) => `「${l.label}」の中身: ${[...(l.items ?? []), ...(l.note ? [l.note] : [])].join("、")}。`)
      .join("");
    return `層の図。下から順に${diagram.layers.map((l) => `「${l.label}」`).join("、")}。${contents}`;
  }
  if (diagram.type === "stepper") {
    return `手順の図。順に${diagram.steps.map((s) => `「${withNote(s.label, s.note)}」`).join("、")}。`;
  }
  if (diagram.type === "toggle") {
    const [a, b] = diagram.states;
    const side = (state: typeof a) =>
      `「${state.label}」では: ${diagram.items
        .map((item) => `${withNote(item.label, item.note)}${mark(item.result[state.id])}`)
        .join("、")}。`;
    return `2 つの状態「${a.label}」と「${b.label}」を切り替える。${side(a)}${side(b)}`;
  }
  if (diagram.type === "decision") {
    const names = new Map(diagram.nodes.map((n) => [n.id, "question" in n ? n.question : n.result]));
    return `判断の図。最初の質問から選んで進む。${diagram.nodes
      .map((n) =>
        "question" in n
          ? `質問「${n.question}」: ${n.choices.map((c) => `「${c.label}」なら「${names.get(c.to) ?? ""}」へ`).join("、")}。`
          : `結論「${withNote(n.result, n.note)}」。`,
      )
      .join("")}`;
  }
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
function DiagramSvg({
  diagram,
  id,
  stacked,
  className,
}: Props & { diagram: StaticDiagram; stacked: boolean; className: string }) {
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

/** 操作で動く図の共通の枠。名前は図の題、説明は describeDiagram(読み上げ)。内容は、操作のたびに変わる */
function InteractiveFrame({ diagram, id, children }: { diagram: Diagram; id: string; children: ReactNode }) {
  return (
    <figure
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-desc`}
      data-diagram-type={diagram.type}
      className="mx-auto w-full max-w-xl space-y-3"
    >
      <figcaption id={`${id}-title`} className="text-sm text-muted">
        {diagram.title}
      </figcaption>
      <span id={`${id}-desc`} className="sr-only">
        {describeDiagram(diagram)}
      </span>
      {children}
    </figure>
  );
}

const BUTTON =
  "rounded-md border border-line bg-surface px-3 py-2 text-sm font-bold text-fg hover:border-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line";

/** 状態の読み上げ。画面には出さず、変わったときに伝える(`aria-live`) */
function LiveText({ children }: { children: string }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {children}
    </p>
  );
}

/** 手順の図: 「次へ」「前へ」「最初から」で 1 段ずつ点灯する。点灯した段に説明が出て、前の段は実線の枠の「済み」になる。 */
function StepperView({ diagram, id }: { diagram: StepperDiagram; id: string }) {
  const [current, setCurrent] = useState(0);
  const last = diagram.steps.length - 1;
  const step = diagram.steps[current];
  return (
    <InteractiveFrame diagram={diagram} id={id}>
      <ol className="space-y-2">
        {diagram.steps.map((s, i) => {
          const phase = i < current ? "done" : i === current ? "now" : "next";
          return (
            <li
              key={s.id}
              data-phase={phase}
              aria-current={phase === "now" ? "step" : undefined}
              className={[
                "motion-lit min-w-0 rounded-md border px-3 py-2",
                phase === "now"
                  ? "border-2 border-primary bg-soft"
                  : phase === "done"
                    ? "border-line bg-surface"
                    : "border-dashed border-line bg-bg",
              ].join(" ")}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span aria-hidden="true" className={phase === "now" ? "text-primary" : "text-muted"}>
                  {phase === "done" ? "✓" : phase === "now" ? "●" : "○"}
                </span>
                <span
                  className={["min-w-0 break-words font-bold", phase === "now" ? "text-primary" : "text-fg"].join(" ")}
                >
                  {i + 1}. {s.label}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {phase === "done" ? "済み" : phase === "now" ? "いま" : "これから"}
                </span>
              </div>
              {phase === "now" && s.note ? <p className="mt-1 break-words text-sm text-fg">{s.note}</p> : null}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BUTTON} disabled={current === 0} onClick={() => setCurrent(current - 1)}>
          前へ
        </button>
        <button type="button" className={BUTTON} disabled={current === last} onClick={() => setCurrent(current + 1)}>
          次へ
        </button>
        <button type="button" className={BUTTON} disabled={current === 0} onClick={() => setCurrent(0)}>
          最初から
        </button>
        <span className="text-sm text-muted">
          {current + 1} / {diagram.steps.length}
        </span>
      </div>
      <LiveText>{`手順 ${current + 1} / ${diagram.steps.length}: ${step?.label ?? ""}。${step?.note ?? ""}`}</LiveText>
    </InteractiveFrame>
  );
}

/**
 * 消える項目の斜線。親の箱(`relative`)の大きさを測って、実寸の座標で引く(`compare` の斜線と同じ引き方)。
 * 測れない環境(`ResizeObserver` がない)では、既定の大きさで描く。
 */
function StrikeOverlay() {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 100, height: 40 });
  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!box || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const { width, height } = box.getBoundingClientRect();
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
    >
      <line
        x1={STRIKE_INSET}
        y1={STRIKE_INSET}
        x2={size.width - STRIKE_INSET}
        y2={size.height - STRIKE_INSET}
        strokeWidth="2"
        strokeLinecap="round"
        pathLength={1}
        className="motion-strike stroke-incorrect"
      />
    </svg>
  );
}

/** 切り替えの図: スイッチで 2 つの状態を切り替える。消える項目に斜線(.motion-strike)を引き、残る項目を強調する。 */
function ToggleView({ diagram, id }: { diagram: ToggleDiagram; id: string }) {
  const [second, setSecond] = useState(false);
  const state = diagram.states[second ? 1 : 0];
  const kept = diagram.items.filter((item) => item.result[state.id] === "kept");
  const removed = diagram.items.filter((item) => item.result[state.id] === "removed");
  return (
    <InteractiveFrame diagram={diagram} id={id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={second ? "text-muted" : "font-bold text-primary"}>
          {second ? "○" : "●"} {diagram.states[0].label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={second}
          aria-label={`${diagram.states[0].label}と${diagram.states[1].label}を切り替える`}
          onClick={() => setSecond(!second)}
          className="relative h-7 w-12 shrink-0 rounded-full border border-line bg-surface hover:border-primary"
        >
          <span
            aria-hidden="true"
            className={[
              "motion-lit absolute top-0.5 h-5 w-5 rounded-full bg-primary",
              second ? "left-[calc(100%-1.375rem)]" : "left-0.5",
            ].join(" ")}
          />
        </button>
        <span className={second ? "font-bold text-primary" : "text-muted"}>
          {second ? "●" : "○"} {diagram.states[1].label}
        </span>
      </div>
      <ul className="space-y-2">
        {diagram.items.map((item) => {
          const isKept = item.result[state.id] === "kept";
          return (
            <li
              key={item.id}
              data-state={isKept ? "kept" : "removed"}
              className={[
                "motion-lit relative min-w-0 overflow-hidden rounded-md border px-3 py-2",
                isKept ? "border-2 border-correct bg-correct-bg" : "border-line bg-surface",
              ].join(" ")}
            >
              <div className="flex min-w-0 items-baseline gap-2">
                <span aria-hidden="true" className={isKept ? "text-correct" : "text-muted"}>
                  {isKept ? "✓" : "×"}
                </span>
                <span className={["min-w-0 break-words font-bold", isKept ? "text-fg" : "text-muted"].join(" ")}>
                  {item.label}
                </span>
                <span className={["ml-auto shrink-0 text-xs", isKept ? "text-correct" : "text-muted"].join(" ")}>
                  {isKept ? "残る" : "消える"}
                </span>
              </div>
              {item.note ? <p className="mt-1 break-words text-sm text-muted">{item.note}</p> : null}
              {isKept ? null : <StrikeOverlay />}
            </li>
          );
        })}
      </ul>
      <LiveText>{`状態「${state.label}」。残る: ${kept.map((i) => i.label).join("、") || "なし"}。消える: ${removed.map((i) => i.label).join("、") || "なし"}。`}</LiveText>
    </InteractiveFrame>
  );
}

/** 判断の図: 質問に答えて進む。選んだ分岐の道筋が点灯し、行き着いた結論が出る。「最初から」で戻る。 */
function DecisionView({ diagram, id }: { diagram: DecisionDiagram; id: string }) {
  // 選んだ選択肢の番号を、先頭の節から順にたどる
  const [picks, setPicks] = useState<number[]>([]);
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const trail: { node: DecisionDiagram["nodes"][number]; pick?: number }[] = [];
  let node: DecisionDiagram["nodes"][number] | undefined = diagram.nodes[0];
  for (const pick of picks) {
    if (!node || !("choices" in node)) break;
    trail.push({ node, pick });
    node = byId.get(node.choices[pick]?.to ?? "");
  }
  const currentRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 進んだとき(選択の数が変わったとき)だけ、新しい節へ目印を移す
  useEffect(() => {
    // 選んだボタンが消えるので、フォーカスを新しい節に移す(最初の表示では動かさない)
    if (moved.current) currentRef.current?.focus();
    moved.current = true;
  }, [picks.length]);
  if (!node) return null;
  const finished = "result" in node;
  const live =
    "result" in node
      ? `結論: ${node.result}。${node.note ?? ""}`
      : `質問: ${node.question}。選択肢は ${node.choices.map((c) => c.label).join("、")}。`;
  return (
    <InteractiveFrame diagram={diagram} id={id}>
      <ol className="space-y-2">
        {trail.map(({ node: past, pick }) =>
          "choices" in past ? (
            <li
              key={past.id}
              data-phase="done"
              className="motion-lit min-w-0 rounded-md border border-primary bg-soft px-3 py-2"
            >
              <p className="break-words font-bold text-primary">
                <span aria-hidden="true">✓ </span>
                {past.question}
              </p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {past.choices.map((c, i) => (
                  <li
                    key={c.label}
                    data-picked={i === pick ? "true" : undefined}
                    className={[
                      "min-w-0 break-words rounded-md border px-2 py-0.5 text-sm",
                      i === pick
                        ? "border-2 border-primary font-bold text-primary"
                        : "border-dashed border-line text-muted",
                    ].join(" ")}
                  >
                    {i === pick ? "▶ 選んだ: " : ""}
                    {c.label}
                  </li>
                ))}
              </ul>
            </li>
          ) : null,
        )}
        <li>
          <div
            ref={currentRef}
            tabIndex={-1}
            data-phase="now"
            className={[
              "motion-lit min-w-0 rounded-md border-2 px-3 py-2",
              finished ? "border-correct bg-correct-bg" : "border-primary bg-surface",
            ].join(" ")}
          >
            {"question" in node ? (
              <>
                <p className="break-words font-bold text-fg">
                  <span aria-hidden="true">? </span>
                  {node.question}
                </p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {node.choices.map((choice, i) => (
                    <button key={choice.label} type="button" className={BUTTON} onClick={() => setPicks([...picks, i])}>
                      {choice.label}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="break-words font-bold text-correct">
                  <span aria-hidden="true">◎ </span>結論: {node.result}
                </p>
                {node.note ? <p className="mt-1 break-words text-sm text-fg">{node.note}</p> : null}
              </>
            )}
          </div>
        </li>
      </ol>
      <div>
        <button type="button" className={BUTTON} disabled={picks.length === 0} onClick={() => setPicks([])}>
          最初から
        </button>
      </div>
      <LiveText>{live}</LiveText>
    </InteractiveFrame>
  );
}

/** 粒の流れの 1 段ごとの間隔(ミリ秒) */
const FLOW_TICK_MS = 900;
/** 箱の中に描く粒の数の上限(それ以上は数字だけで伝える) */
const MAX_DOTS = 10;

function Dots({ count, mark: symbol, className }: { count: number; mark: string; className: string }) {
  return (
    <span aria-hidden="true" className={["motion-particle inline-block tracking-widest", className].join(" ")}>
      {symbol.repeat(Math.min(count, MAX_DOTS))}
    </span>
  );
}

/**
 * データの流れの図: 箱を上から下へ並べ、「再生」で粒が箱から箱へ流れる。絞り込みの箱では、粒の一部が落ちる。
 * 自動では動かず、「再生」を押したときだけ、1 段ずつ流れて 1 周で止まる。
 * 「動きを減らす」設定とシンプルな画面スタイルでは、再生せず、流れ終わった状態を出す。
 */
function DataflowView({ diagram, id }: { diagram: DataflowDiagram; id: string }) {
  const style = useVisualStyle();
  const reduced = usePrefersReducedMotion();
  const animated = effectsEnabled(style, reduced);
  const plan = planDataflow(diagram);
  const last = plan.levels.length - 1;
  // -1: まだ流れていない。0 以上: その段まで粒が届いている
  const [started, setStarted] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const step = animated ? started : last;
  useEffect(() => {
    if (!animated || !playing) return;
    const timer = setTimeout(() => {
      if (started + 1 >= last) setPlaying(false);
      setStarted(started + 1);
    }, FLOW_TICK_MS);
    return () => clearTimeout(timer);
  }, [animated, playing, started, last]);
  const play = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (started < 0 || started >= last) setStarted(0);
    if (started < 0 && last === 0) return;
    setPlaying(true);
  };
  const finished = step >= last;
  const live = (() => {
    if (step < 0) return "まだ流れていません。再生を押すと、粒が流れます。";
    const names = plan.levels[Math.min(step, last)]?.map((n) => n.label).join("、") ?? "";
    return finished
      ? `流れ終わりました。最後は「${names}」です。`
      : `${step + 1} / ${plan.levels.length} 段目: 「${names}」に粒が届きました。`;
  })();
  return (
    <InteractiveFrame diagram={diagram} id={id}>
      {animated ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={BUTTON} onClick={play}>
            {playing ? "一時停止" : finished ? "もう一度再生" : "再生"}
          </button>
          <span className="text-sm text-muted">
            {playing ? "▶ 流れています" : finished ? "■ 流れ終わり" : "■ 止まっています"}
          </span>
        </div>
      ) : (
        <p className="text-sm text-muted">■ 動きを止めています。流れ終わった状態を表示しています。</p>
      )}
      <ol className="space-y-2">
        {plan.levels.map((row, level) => (
          <li key={row.map((n) => n.id).join("+")} className="space-y-2">
            {level > 0 ? (
              <p aria-hidden="true" className="text-center text-muted">
                ↓
              </p>
            ) : null}
            <ul className="flex flex-wrap gap-2">
              {row.map((n) => {
                const reached = level <= step;
                const stat = plan.stats.get(n.id);
                const next = plan.next.get(n.id) ?? [];
                return (
                  <li
                    key={n.id}
                    data-reached={reached ? "true" : "false"}
                    data-filter={n.filter ? "true" : undefined}
                    className={[
                      "motion-lit min-w-0 flex-1 basis-40 rounded-md border px-3 py-2",
                      reached ? "border-2 border-primary bg-soft" : "border-dashed border-line bg-bg",
                    ].join(" ")}
                  >
                    <p className="break-words font-bold text-fg">
                      {n.filter ? <span aria-hidden="true">▽ </span> : null}
                      {n.label}
                      {n.filter ? <span className="ml-1 text-xs font-normal text-muted">(絞り込み)</span> : null}
                    </p>
                    {n.note ? <p className="break-words text-sm text-muted">{n.note}</p> : null}
                    {reached && stat ? (
                      <div className="mt-1 text-sm">
                        <p className="break-all leading-6">
                          <Dots count={stat.passed} mark="●" className="text-primary" />
                          {stat.dropped > 0 ? <Dots count={stat.dropped} mark="×" className="text-incorrect" /> : null}
                        </p>
                        <p className="text-xs text-muted">
                          {n.filter
                            ? `${stat.arrived} 個のうち ${stat.passed} 個が通り、${stat.dropped} 個が落ちる`
                            : `${stat.arrived} 個が通る`}
                        </p>
                      </div>
                    ) : null}
                    {next.length > 0 ? (
                      <p className="mt-1 break-words text-xs text-muted">次: {next.join("、")}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      <LiveText>{live}</LiveText>
    </InteractiveFrame>
  );
}

/**
 * 層の図: 層が下から積み上がる(積み上がる動きは、動きを減らす設定とシンプルな画面スタイルでは出ない)。
 * 層を選ぶと、その層の中身(語句と説明)が開く。開くのは 1 つの層だけで、開いている層を選ぶと閉じる。
 */
function LayersView({ diagram, id }: { diagram: LayersDiagram; id: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = diagram.layers.length;
  const openLayer = diagram.layers.find((l) => l.id === open);
  const live = openLayer
    ? `「${openLayer.label}」の中身を開きました。${[...(openLayer.items ?? []), ...(openLayer.note ? [openLayer.note] : [])].join("、")}。`
    : "層の中身は閉じています。";
  return (
    <InteractiveFrame diagram={diagram} id={id}>
      {/* 先頭の層がいちばん下。画面にも読み上げにも、上の層から順に並べる(見た目の順と、キーボードの順を合わせる) */}
      <ol className="flex flex-col gap-2">
        {diagram.layers
          .map((layer, i) => ({ layer, i }))
          .reverse()
          .map(({ layer, i }) => {
            const hasContent = Boolean(layer.items?.length || layer.note);
            const isOpen = open === layer.id;
            const panelId = `${id}-layer-${layer.id}`;
            return (
              <li
                key={layer.id}
                data-open={hasContent ? String(isOpen) : undefined}
                style={{ animationDelay: `${i * 0.12}s` }}
                className={[
                  "motion-stack motion-lit min-w-0 rounded-md border px-3 py-2",
                  isOpen ? "border-2 border-primary bg-soft" : "border-line bg-surface",
                ].join(" ")}
              >
                {hasContent ? (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? null : layer.id)}
                    className="flex w-full min-w-0 items-baseline gap-2 text-left"
                  >
                    <span aria-hidden="true" className="text-primary">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span className="min-w-0 break-words font-bold text-fg">{layer.label}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">
                      {i + 1} / {total} 層目・{isOpen ? "中身を閉じる" : "中身を開く"}
                    </span>
                  </button>
                ) : (
                  <div className="flex w-full min-w-0 items-baseline gap-2">
                    <span className="min-w-0 break-words font-bold text-fg">{layer.label}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">
                      {i + 1} / {total} 層目
                    </span>
                  </div>
                )}
                {hasContent ? (
                  <div id={panelId} hidden={!isOpen} className="mt-2 space-y-1">
                    {layer.items ? (
                      <ul className="flex flex-wrap gap-2">
                        {layer.items.map((item) => (
                          <li
                            key={item}
                            className="min-w-0 break-words rounded-md border border-line bg-bg px-2 py-0.5 text-sm text-fg"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {layer.note ? <p className="break-words text-sm text-fg">{layer.note}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
      </ol>
      <LiveText>{live}</LiveText>
    </InteractiveFrame>
  );
}

/**
 * 流れ・比較・階層・時系列・表の変化の図(SVG)と、手順・切り替え・判断・データの流れ・層の図(HTML。利用者の操作で動く)。
 * 色はテーマの役割の色だけを使い、ライトとダークの両方で読めるようにする。
 * 体系ノートなど、特定の画面に依存しない(どの画面からも使える)。
 * `stackOnNarrow` の比較・時系列・表の変化の図は、左右に並べた図と、上下に積んだ図を描き、画面の幅で片方だけを出す(CSS の `sm`)。
 * 出さないほうは `display: none` なので、読み上げでも 1 つだけになる。操作で動く図は、もともと上下に積む。
 * 動きは、「動きを減らす」設定とシンプルな画面スタイルでは止まり、状態だけが切り替わる(globals.css の `.motion-*`)。
 */
export function DiagramView({ diagram, id, stackOnNarrow = false }: Props) {
  if (diagram.type === "stepper") return <StepperView diagram={diagram} id={id} />;
  if (diagram.type === "toggle") return <ToggleView diagram={diagram} id={id} />;
  if (diagram.type === "decision") return <DecisionView diagram={diagram} id={id} />;
  if (diagram.type === "dataflow") return <DataflowView diagram={diagram} id={id} />;
  if (diagram.type === "layers") return <LayersView diagram={diagram} id={id} />;
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
