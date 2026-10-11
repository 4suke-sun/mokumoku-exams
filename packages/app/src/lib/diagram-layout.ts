import type { Diagram } from "../../../../scripts/lib/curriculum-data/schema.ts";

// 図解(箱と矢印)の配置を決める。描画(components/diagram.tsx)から切り離した純粋な関数にして、単体テストする。
// - 箱は、矢印の向きに沿って上から下へ段に並べる(入ってくる矢印の元のうち、いちばん下の段の次の段)。
// - 矢印のラベルは、段と段の間の帯に、行を分けて置く。帯の行の数を、その帯に置くラベルの数以上にするので、
//   ラベルどうし、ラベルと箱は、必ず重ならない。ほかの矢印の線にかからない行があれば、そこを選ぶ。
// 文字の幅は、全角を 1 文字分、半角を 0.6 文字分として見積もる(描画の前に文字の大きさを測れないため)。

export type { Diagram };

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

export type PlacedNode = Box & { id: string; label: string; layer: number };
export type PlacedEdge = {
  from: string;
  to: string;
  label?: string;
  /** 線の始点と終点(終点は矢じりの根元) */
  start: Point;
  end: Point;
  /** 矢じりの三角形(先端、根元の両端) */
  arrow: [Point, Point, Point];
  /** ラベルの箱(ラベルのない矢印は undefined) */
  labelBox?: Box;
};
export type DiagramLayout = { width: number; height: number; nodes: PlacedNode[]; edges: PlacedEdge[] };

export const NODE_FONT_SIZE = 14;
export const LABEL_FONT_SIZE = 12;
const NODE_PADDING_X = 12;
const NODE_HEIGHT = 36;
const NODE_GAP_X = 24;
const LABEL_PADDING_X = 6;
const LABEL_HEIGHT = 20;
/** ラベルの 1 行の高さ。行どうしの間を空け、別の行のラベルと重ならないようにする */
const LABEL_ROW = LABEL_HEIGHT + 4;
/** 帯の行の数の最小。奇数にして、ラベルが少ない帯では、矢印の中ほど(真ん中の行)に置く。帯の高さも、矢印の傾きが急になりすぎない程度に保つ */
const MIN_ROWS = 3;
const ARROW_LENGTH = 8;
const BAND_PADDING = 6;
const MARGIN = 8;

/** 文字列の幅の見積もり。全角(半角の範囲の外)を 1 文字分、半角を 0.6 文字分とする */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) units += (char.codePointAt(0) ?? 0) > 0xff ? 1 : 0.6;
  return units * fontSize;
}

/** 2 つの箱が重なるか(辺が接するだけなら重ならない) */
export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 線分が箱の内側を通るか(Liang–Barsky の切り取り) */
export function segmentCrossesBox(p: Point, q: Point, box: Box): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const checks: [number, number][] = [
    [-dx, p.x - box.x],
    [dx, box.x + box.width - p.x],
    [-dy, p.y - box.y],
    [dy, box.y + box.height - p.y],
  ];
  for (const [step, room] of checks) {
    if (step === 0) {
      if (room <= 0) return false;
      continue;
    }
    const t = room / step;
    if (step < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

/** 箱ごとの段。入ってくる矢印のない箱が 0 段目。閉路があれば(検査で落ちるため通常は起きない)、残りを 1 段ずつ下に置く */
function assignLayers(diagram: Diagram): Map<string, number> {
  const layers = new Map<string, number>();
  const indegree = new Map(diagram.nodes.map((node) => [node.id, 0]));
  for (const edge of diagram.edges) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  const queue = diagram.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) layers.set(id, 0);
  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    const layer = layers.get(id) ?? 0;
    for (const edge of diagram.edges) {
      if (edge.from !== id || !indegree.has(edge.to)) continue;
      layers.set(edge.to, Math.max(layers.get(edge.to) ?? 0, layer + 1));
      const rest = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, rest);
      if (rest === 0) queue.push(edge.to);
    }
  }
  // 閉路の箱と、その先の箱は、入ってくる矢印が残る。並べ終えた箱の下に、データの順に 1 段ずつ置く
  const done = diagram.nodes.filter((node) => indegree.get(node.id) === 0);
  let next = Math.max(-1, ...done.map((node) => layers.get(node.id) ?? 0)) + 1;
  for (const node of diagram.nodes) {
    if ((indegree.get(node.id) ?? 0) > 0) {
      layers.set(node.id, next);
      next += 1;
    }
  }
  return layers;
}

/** 段ごとの箱の並び。データの順を初期値にし、上の段の元の箱の位置の平均に近い順に並べ替えて、線の交差を減らす */
function orderLayers(diagram: Diagram, layers: Map<string, number>): string[][] {
  const count = Math.max(0, ...layers.values()) + 1;
  const rows: string[][] = Array.from({ length: count }, () => []);
  for (const node of diagram.nodes) rows[layers.get(node.id) ?? 0]?.push(node.id);
  // 位置は、段の中の左端を 0、右端を 1 とした割合(箱の数の違う段どうしで比べられるようにする)
  const ratio = (i: number, length: number) => (length > 1 ? i / (length - 1) : 0.5);
  const position = new Map<string, number>();
  rows.forEach((row, layer) => {
    if (layer > 0) {
      const key = new Map(
        row.map((id, i) => {
          const parents = diagram.edges.filter((e) => e.to === id && position.has(e.from));
          const sum = parents.reduce((total, e) => total + (position.get(e.from) ?? 0), 0);
          return [id, parents.length > 0 ? sum / parents.length : ratio(i, row.length)];
        }),
      );
      row.sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0));
    }
    row.forEach((id, i) => {
      position.set(id, ratio(i, row.length));
    });
  });
  return rows;
}

/** 優先する行の順: 真ん中から外へ */
function rowPreference(rows: number): number[] {
  const order: number[] = [];
  const middle = (rows - 1) / 2;
  for (let i = 0; i < rows; i += 1) order.push(i);
  return order.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
}

function arrowHead(start: Point, tip: Point): { base: Point; arrow: [Point, Point, Point] } {
  const length = Math.hypot(tip.x - start.x, tip.y - start.y) || 1;
  const ux = (tip.x - start.x) / length;
  const uy = (tip.y - start.y) / length;
  const base = { x: tip.x - ux * ARROW_LENGTH, y: tip.y - uy * ARROW_LENGTH };
  const half = ARROW_LENGTH * 0.6;
  return {
    base,
    arrow: [tip, { x: base.x - uy * half, y: base.y + ux * half }, { x: base.x + uy * half, y: base.y - ux * half }],
  };
}

export function layoutDiagram(diagram: Diagram): DiagramLayout {
  const layers = assignLayers(diagram);
  const rows = orderLayers(diagram, layers);
  const labelById = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  const widthOf = (id: string) => textWidth(labelById.get(id) ?? "", NODE_FONT_SIZE) + NODE_PADDING_X * 2;

  // 帯(段 a と a+1 の間)ごとに、置くラベルの数を数え、帯の高さを決める
  const bandOf = (edge: { from: string; to: string }) => Math.min(layers.get(edge.from) ?? 0, layers.get(edge.to) ?? 0);
  const labelsInBand = new Map<number, number>();
  for (const edge of diagram.edges) {
    if (edge.label) labelsInBand.set(bandOf(edge), (labelsInBand.get(bandOf(edge)) ?? 0) + 1);
  }
  const bandRows = (band: number) => Math.max(MIN_ROWS, labelsInBand.get(band) ?? 0);
  const bandHeight = (band: number) => (ARROW_LENGTH + BAND_PADDING) * 2 + bandRows(band) * LABEL_ROW;

  const layerY: number[] = [];
  rows.forEach((_, layer) => {
    layerY.push(layer === 0 ? 0 : (layerY[layer - 1] ?? 0) + NODE_HEIGHT + bandHeight(layer - 1));
  });

  const rowWidths = rows.map((row) => row.reduce((sum, id) => sum + widthOf(id), 0) + NODE_GAP_X * (row.length - 1));
  const widest = Math.max(...rowWidths);
  const nodes: PlacedNode[] = [];
  rows.forEach((row, layer) => {
    let x = (widest - (rowWidths[layer] ?? 0)) / 2;
    for (const id of row) {
      const width = widthOf(id);
      nodes.push({ id, label: labelById.get(id) ?? "", layer, x, y: layerY[layer] ?? 0, width, height: NODE_HEIGHT });
      x += width + NODE_GAP_X;
    }
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edges: PlacedEdge[] = diagram.edges.flatMap((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) return [];
    const down = to.layer > from.layer;
    const start = { x: from.x + from.width / 2, y: down ? from.y + from.height : from.y };
    const tip = { x: to.x + to.width / 2, y: down ? to.y : to.y + to.height };
    const { base, arrow } = arrowHead(start, tip);
    return [{ from: edge.from, to: edge.to, ...(edge.label ? { label: edge.label } : {}), start, end: base, arrow }];
  });

  // ラベルを、帯の行に 1 つずつ置く。ほかのラベル・箱と重ならない行のうち、ほかの線にかからない行を優先する
  const placed: Box[] = [];
  for (const edge of edges) {
    if (!edge.label) continue;
    const band = bandOf(edge);
    const top = (layerY[band] ?? 0) + NODE_HEIGHT + ARROW_LENGTH + BAND_PADDING;
    const width = textWidth(edge.label, LABEL_FONT_SIZE) + LABEL_PADDING_X * 2;
    const candidates = rowPreference(bandRows(band)).map((row) => {
      const cy = top + row * LABEL_ROW + LABEL_ROW / 2;
      const t = (cy - edge.start.y) / (edge.end.y - edge.start.y || 1);
      const cx = edge.start.x + (edge.end.x - edge.start.x) * t;
      return { x: cx - width / 2, y: cy - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT };
    });
    const free = candidates.filter(
      (box) => !placed.some((other) => overlaps(box, other)) && !nodes.some((node) => overlaps(box, node)),
    );
    const clear = free.find((box) =>
      edges.every((other) => other === edge || !segmentCrossesBox(other.start, other.end, box)),
    );
    const chosen = clear ?? free[0] ?? candidates[0];
    if (!chosen) continue;
    edge.labelBox = chosen;
    placed.push(chosen);
  }

  // 全体が収まるよう、左上を余白の位置にそろえる
  const boxes: Box[] = [...nodes, ...placed];
  const minX = Math.min(...boxes.map((box) => box.x));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  const dx = MARGIN - minX;
  const dy = MARGIN;
  const move = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
  const moveBox = <T extends Box>(box: T): T => ({ ...box, x: box.x + dx, y: box.y + dy });
  return {
    width: maxX - minX + MARGIN * 2,
    height: maxY + MARGIN * 2,
    nodes: nodes.map(moveBox),
    edges: edges.map((edge) => ({
      ...edge,
      start: move(edge.start),
      end: move(edge.end),
      arrow: [move(edge.arrow[0]), move(edge.arrow[1]), move(edge.arrow[2])],
      ...(edge.labelBox ? { labelBox: moveBox(edge.labelBox) } : {}),
    })),
  };
}
