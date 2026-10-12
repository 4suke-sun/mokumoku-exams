import type {
  CompareDiagram,
  Diagram,
  FlowDiagram,
  HierarchyDiagram,
  HierarchyNode,
} from "../../../../scripts/lib/curriculum-data/schema.ts";

// 図解の配置を決める。描画(components/diagram.tsx)から切り離した純粋な関数にして、単体テストする。
// 流れの図(flow):
// - 箱は、矢印の向きに沿って上から下へ段に並べる(入ってくる矢印の元のうち、いちばん下の段の次の段)。
// - 矢印のラベルは、段と段の間の帯に、行を分けて置く。帯の行の数を、その帯に置くラベルの数以上にするので、
//   ラベルどうし、ラベルと箱は、必ず重ならない。ほかの矢印の線にかからない行があれば、そこを選ぶ。
// 比較の図(compare): 左右に、見出しの箱と項目の箱を並べる。左右の項目は、同じ行どうしを対応させる。
// 階層の図(hierarchy): 根の箱の中に、子の箱を入れ子にして、上から順に並べる。
// 箱の文字は、折り返し、それでも収まらなければ小さくする(`fitText`)。収まらない図は、`diagramProblems` が報告する。
// 文字の幅は、全角を 1 文字分、半角を 0.6 文字分として見積もる(描画の前に文字の大きさを測れないため)。

export type { CompareDiagram, Diagram, FlowDiagram, HierarchyDiagram };

export type Box = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** 箱の中の文字の 1 行。`x` と `y` は、行の中心(`textAnchor="middle"`、`dominantBaseline="central"`) */
export type PlacedText = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  role: "label" | "note" | "heading";
  /** 文字が、箱の中の幅に収まっているか(折り返しと縮小のあと) */
  fits: boolean;
};

export type PlacedNode = Box & { id: string; label: string; layer: number; texts: PlacedText[] };
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
export type DiagramLayout = {
  kind: "flow";
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
};

/** 比較・階層の図の箱。`tone` は、色の役割(画面側で、色に対応させる) */
export type PlacedBox = Box & {
  tone: "heading-left" | "heading-right" | "item" | "depth-0" | "depth-1" | "depth-2" | "depth-3";
  texts: PlacedText[];
};
export type BoxLayout = {
  kind: "compare" | "hierarchy";
  width: number;
  height: number;
  boxes: PlacedBox[];
  /** 比較の図の、左右の見出しの間に置く「vs」の位置 */
  versus?: Point;
};
export type AnyLayout = DiagramLayout | BoxLayout;

export const NODE_FONT_SIZE = 14;
export const LABEL_FONT_SIZE = 12;
/** 箱の説明(note)の文字の大きさ */
export const NOTE_FONT_SIZE = 11;
/** 縮めてよい文字の大きさの下限。これより小さくしないと収まらない図は、検査が失敗にする */
export const MIN_FONT_SIZE = 10;
const NODE_PADDING_X = 12;
const NODE_PADDING_Y = 9;
const NODE_MIN_HEIGHT = 36;
/** 流れの図の箱の幅の上限(説明のある箱が横に広がりすぎないように、これを超える文字は折り返す) */
const NODE_MAX_WIDTH = 200;
const LABEL_LINE_HEIGHT = 18;
const NOTE_LINE_HEIGHT = 14;
const NOTE_GAP = 2;
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
/** 比較・階層の図の幅(これを基準に、画面の幅に合わせて縮む) */
const WIDE_WIDTH = 600;
const COMPARE_GAP = 48;
const ROW_GAP = 8;
const NEST_PADDING = 10;
/** 流れの図の幅の目安の上限。これを超えると、狭い画面で文字が小さくなりすぎる */
export const MAX_FLOW_WIDTH = 960;

/** 文字列の幅の見積もり。全角(半角の範囲の外)を 1 文字分、半角を 0.6 文字分とする */
export function textWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) units += (char.codePointAt(0) ?? 0) > 0xff ? 1 : 0.6;
  return units * fontSize;
}

/** 行頭に置かない文字(句読点、閉じ括弧など)。直前の行の末尾に付けて折り返す */
const NO_LINE_START = new Set("、。，．,.)）]］」』】〉》!?！？:：;；%％");

/** 実際のフォントは、見積もりより少し幅が出ることがある。収まるかの判定は、この余裕を見込む */
const FIT_SAFETY = 1.04;

/** 文字列を、幅 `maxWidth` に収まる行に折り返す(文字単位。行頭に置かない文字は、前の行に付ける) */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    const next = line + char;
    if (line !== "" && textWidth(next, fontSize) * FIT_SAFETY > maxWidth && !NO_LINE_START.has(char)) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

export type FittedText = { lines: string[]; fontSize: number; fits: boolean };

/**
 * 文字を、幅 `maxWidth`・`maxLines` 行に収める。まず `fontSize` で折り返し、収まらなければ 1 ずつ小さくする。
 * `MIN_FONT_SIZE` まで小さくしても収まらなければ、`fits` が false(最小の大きさで折り返した行を返す)。
 */
export function fitText(text: string, maxWidth: number, fontSize: number, maxLines: number): FittedText {
  let size = fontSize;
  for (; size >= MIN_FONT_SIZE; size -= 1) {
    const lines = wrapText(text, maxWidth, size);
    if (lines.length <= maxLines) return { lines, fontSize: size, fits: true };
  }
  return { lines: wrapText(text, maxWidth, MIN_FONT_SIZE), fontSize: MIN_FONT_SIZE, fits: false };
}

/** 題(と説明)を `maxInner` 幅に収めて、箱の高さと、行の並び(箱の上端からの相対位置)を決める */
function fitBoxText(
  label: string,
  note: string | undefined,
  maxInner: number,
  role: "label" | "heading",
): { texts: Omit<PlacedText, "x">[]; width: number; height: number } {
  const labelFit = fitText(label, maxInner, NODE_FONT_SIZE, 2);
  const texts: Omit<PlacedText, "x">[] = [];
  let y = NODE_PADDING_Y;
  for (const text of labelFit.lines) {
    texts.push({ text, y: y + LABEL_LINE_HEIGHT / 2, fontSize: labelFit.fontSize, role, fits: labelFit.fits });
    y += LABEL_LINE_HEIGHT;
  }
  let widest = Math.max(0, ...labelFit.lines.map((line) => textWidth(line, labelFit.fontSize)));
  if (note) {
    y += NOTE_GAP;
    const noteFit = fitText(note, maxInner, NOTE_FONT_SIZE, 3);
    for (const text of noteFit.lines) {
      texts.push({ text, y: y + NOTE_LINE_HEIGHT / 2, fontSize: noteFit.fontSize, role: "note", fits: noteFit.fits });
      y += NOTE_LINE_HEIGHT;
    }
    widest = Math.max(widest, ...noteFit.lines.map((line) => textWidth(line, noteFit.fontSize)));
  }
  return { texts, width: widest, height: Math.max(NODE_MIN_HEIGHT, y + NODE_PADDING_Y) };
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
function assignLayers(diagram: FlowDiagram): Map<string, number> {
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
function orderLayers(diagram: FlowDiagram, layers: Map<string, number>): string[][] {
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

export function layoutDiagram(diagram: FlowDiagram): DiagramLayout {
  const layers = assignLayers(diagram);
  const rows = orderLayers(diagram, layers);
  const labelById = new Map(diagram.nodes.map((node) => [node.id, node.label]));
  // 箱の文字は、幅の上限の中で折り返す。幅は、いちばん長い行に合わせる
  const fitted = new Map(
    diagram.nodes.map((node) => [
      node.id,
      fitBoxText(node.label, node.note, NODE_MAX_WIDTH - NODE_PADDING_X * 2, "label"),
    ]),
  );
  const widthOf = (id: string) => Math.ceil((fitted.get(id)?.width ?? 0) * FIT_SAFETY) + NODE_PADDING_X * 2;
  const heightOf = (id: string) => fitted.get(id)?.height ?? NODE_MIN_HEIGHT;
  const layerHeight = rows.map((row) => Math.max(NODE_MIN_HEIGHT, ...row.map(heightOf)));

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
    layerY.push(layer === 0 ? 0 : (layerY[layer - 1] ?? 0) + (layerHeight[layer - 1] ?? 0) + bandHeight(layer - 1));
  });

  const rowWidths = rows.map((row) => row.reduce((sum, id) => sum + widthOf(id), 0) + NODE_GAP_X * (row.length - 1));
  const widest = Math.max(...rowWidths);
  const nodes: PlacedNode[] = [];
  rows.forEach((row, layer) => {
    let x = (widest - (rowWidths[layer] ?? 0)) / 2;
    for (const id of row) {
      const width = widthOf(id);
      const height = heightOf(id);
      // 同じ段の中では、箱を縦の中央にそろえる
      const y = (layerY[layer] ?? 0) + ((layerHeight[layer] ?? height) - height) / 2;
      const texts = (fitted.get(id)?.texts ?? []).map((t) => ({ ...t, x: x + width / 2, y: y + t.y }));
      nodes.push({ id, label: labelById.get(id) ?? "", layer, x, y, width, height, texts });
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
    const top = (layerY[band] ?? 0) + (layerHeight[band] ?? NODE_MIN_HEIGHT) + ARROW_LENGTH + BAND_PADDING;
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
  const moveNode = (node: PlacedNode): PlacedNode => ({
    ...moveBox(node),
    texts: node.texts.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
  });
  return {
    kind: "flow",
    width: maxX - minX + MARGIN * 2,
    height: maxY + MARGIN * 2,
    nodes: nodes.map(moveNode),
    edges: edges.map((edge) => ({
      ...edge,
      start: move(edge.start),
      end: move(edge.end),
      arrow: [move(edge.arrow[0]), move(edge.arrow[1]), move(edge.arrow[2])],
      ...(edge.labelBox ? { labelBox: moveBox(edge.labelBox) } : {}),
    })),
  };
}

/** 箱の中の文字の行を、箱の位置に合わせて絶対位置にする(幅の中央にそろえる) */
function placeTexts(texts: Omit<PlacedText, "x">[], box: Box): PlacedText[] {
  return texts.map((t) => ({ ...t, x: box.x + box.width / 2, y: box.y + t.y }));
}

/** 比較の図: 左右の列に、見出しと項目を並べる。同じ行の左右は、高いほうに高さをそろえる。 */
export function layoutCompare(diagram: CompareDiagram): BoxLayout {
  const column = (WIDE_WIDTH - COMPARE_GAP) / 2;
  const inner = column - NODE_PADDING_X * 2;
  const leftX = MARGIN;
  const rightX = MARGIN + column + COMPARE_GAP;
  const boxes: PlacedBox[] = [];

  const headingFit = {
    left: fitBoxText(diagram.left.heading, undefined, inner, "heading"),
    right: fitBoxText(diagram.right.heading, undefined, inner, "heading"),
  };
  const headingHeight = Math.max(headingFit.left.height, headingFit.right.height);
  for (const side of ["left", "right"] as const) {
    const box = { x: side === "left" ? leftX : rightX, y: MARGIN, width: column, height: headingHeight };
    boxes.push({ ...box, tone: `heading-${side}`, texts: placeTexts(headingFit[side].texts, box) });
  }

  let y = MARGIN + headingHeight + ROW_GAP;
  const rowCount = Math.max(diagram.left.items.length, diagram.right.items.length);
  for (let i = 0; i < rowCount; i += 1) {
    const fits = [diagram.left.items[i], diagram.right.items[i]].map((item) =>
      item ? fitBoxText(item.label, item.note, inner, "label") : null,
    );
    const height = Math.max(NODE_MIN_HEIGHT, ...fits.map((fit) => fit?.height ?? 0));
    fits.forEach((fit, side) => {
      if (!fit) return;
      const box = { x: side === 0 ? leftX : rightX, y, width: column, height };
      boxes.push({ ...box, tone: "item", texts: placeTexts(fit.texts, box) });
    });
    y += height + ROW_GAP;
  }
  return {
    kind: "compare",
    width: WIDE_WIDTH + MARGIN * 2,
    height: y - ROW_GAP + MARGIN,
    boxes,
    versus: { x: MARGIN + column + COMPARE_GAP / 2, y: MARGIN + headingHeight / 2 },
  };
}

const DEPTH_TONES = ["depth-0", "depth-1", "depth-2", "depth-3"] as const;

/** 階層の図: 根の箱の中に、子の箱を入れ子にして、上から順に並べる。 */
export function layoutHierarchy(diagram: HierarchyDiagram): BoxLayout {
  const boxes: PlacedBox[] = [];
  /** 箱を置き、置いた高さを返す。親の箱は子より先に並べる(描く順) */
  const place = (node: HierarchyNode, x: number, y: number, width: number, depth: number): number => {
    const fit = fitBoxText(node.label, node.note, width - NODE_PADDING_X * 2, "label");
    const index = boxes.length;
    const box: PlacedBox = {
      x,
      y,
      width,
      height: fit.height,
      tone: DEPTH_TONES[Math.min(depth, DEPTH_TONES.length - 1)] ?? "depth-3",
      texts: [],
    };
    boxes.push(box);
    let height = fit.height;
    // 題と説明は、箱の上の端に寄せる(子が並ぶので、中央にはしない)
    const texts = placeTexts(fit.texts, box);
    if (node.children && node.children.length > 0) {
      let childY = y + fit.height;
      for (const child of node.children) {
        childY += place(child, x + NEST_PADDING, childY, width - NEST_PADDING * 2, depth + 1) + ROW_GAP;
      }
      height = childY - ROW_GAP + NEST_PADDING - y;
    }
    boxes[index] = { ...box, height, texts };
    return height;
  };
  const rootHeight = place(diagram.root, MARGIN, MARGIN, WIDE_WIDTH, 0);
  return { kind: "hierarchy", width: WIDE_WIDTH + MARGIN * 2, height: rootHeight + MARGIN * 2, boxes };
}

/** 図の種類に応じて配置する */
export function layoutAny(diagram: Diagram): AnyLayout {
  switch (diagram.type) {
    case "flow":
      return layoutDiagram(diagram);
    case "compare":
      return layoutCompare(diagram);
    case "hierarchy":
      return layoutHierarchy(diagram);
  }
}

/**
 * 図の配置の問題を、文章で返す(問題がなければ空)。CI の検査(実データのすべての図)と、画面の確認に使う。
 * - 文字が、折り返しと縮小のあとでも、箱の幅に収まらない
 * - 文字の行が、箱の高さからはみ出す
 * - 箱が、図の範囲からはみ出す
 * - 流れの図が広すぎる(狭い画面で、文字が小さくなりすぎる)
 */
export function diagramProblems(layout: AnyLayout): string[] {
  const problems: string[] = [];
  const boxes: (Box & { texts: PlacedText[]; name: string })[] =
    layout.kind === "flow"
      ? layout.nodes.map((n) => ({ ...n, name: `箱「${n.label}」` }))
      : layout.boxes.map((b, i) => ({ ...b, name: `${i + 1} 番目の箱(${b.tone})` }));
  for (const box of boxes) {
    for (const t of box.texts) {
      if (!t.fits) problems.push(`${box.name}の文字が、最小の大きさに縮めても幅に収まりません`);
      const half = textWidth(t.text, t.fontSize) / 2;
      if (t.x - half < box.x - 0.5 || t.x + half > box.x + box.width + 0.5) {
        problems.push(`${box.name}の文字の行が、箱の幅からはみ出します`);
      }
      if (t.y - t.fontSize / 2 < box.y - 0.5 || t.y + t.fontSize / 2 > box.y + box.height + 0.5) {
        problems.push(`${box.name}の文字の行が、箱の高さからはみ出します`);
      }
    }
    if (box.x < 0 || box.y < 0 || box.x + box.width > layout.width + 0.5 || box.y + box.height > layout.height + 0.5) {
      problems.push(`${box.name}が、図の範囲からはみ出します`);
    }
  }
  if (layout.kind === "flow" && layout.width > MAX_FLOW_WIDTH) {
    problems.push(
      `図の幅が広すぎます(${Math.round(layout.width)}。上限 ${MAX_FLOW_WIDTH})。1 つの段の箱を減らしてください`,
    );
  }
  return [...new Set(problems)];
}
