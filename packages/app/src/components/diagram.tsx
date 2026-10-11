import { type Diagram, LABEL_FONT_SIZE, layoutDiagram, NODE_FONT_SIZE } from "@/lib/diagram-layout.ts";

type Props = {
  diagram: Diagram;
  /** 図の要素の ID の接頭辞(読み上げの名前と説明を結びつける。ページの中で一意にする) */
  id: string;
};

/** 読み上げ用の説明: 矢印ごとに「「A」から「B」へ(ラベル)。」を並べる */
export function describeDiagram(diagram: Diagram): string {
  const labels = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  return diagram.edges
    .map((edge) => {
      const text = `「${labels.get(edge.from) ?? ""}」から「${labels.get(edge.to) ?? ""}」へ`;
      return `${edge.label ? `${text}(${edge.label})` : text}。`;
    })
    .join("");
}

/** 箱と矢印の図。色はテーマの役割の色を使い、ライトとダークの両方で読めるようにする */
export function DiagramView({ diagram, id }: Props) {
  const layout = layoutDiagram(diagram);
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  return (
    <figure className="space-y-2">
      <svg
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        // 幅の狭い画面では縮めて、横にはみ出さないようにする(広い画面では、元の大きさより広げない)
        className="h-auto w-full"
        style={{ maxWidth: layout.width }}
      >
        <title id={titleId}>{diagram.title}</title>
        <desc id={descId}>{describeDiagram(diagram)}</desc>
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
              className="fill-bg stroke-primary"
            />
            <text
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={NODE_FONT_SIZE}
              className="fill-fg"
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
      {/* 読み上げでは、図の名前(title)で伝わるので、見出しを重ねて読ませない */}
      <figcaption aria-hidden="true" className="text-sm text-muted">
        {diagram.title}
      </figcaption>
    </figure>
  );
}
