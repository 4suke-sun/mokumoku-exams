import type {
  CompareDiagram,
  CompareItemState,
  Diagram,
  FlowDiagram,
  HierarchyDiagram,
  HierarchyNode,
  HierarchyNodeState,
  TableChangeDiagram,
  TableChangeState,
  TimelineDiagram,
} from "@mokumoku-exams/data-schema/curriculum-data/schema";

// 図解の配置を決める。描画(components/diagram.tsx)から切り離した純粋な関数にして、単体テストする。
// 流れの図(flow):
// - 箱は、矢印の向きに沿って上から下へ段に並べる(入ってくる矢印の元のうち、いちばん下の段の次の段)。
// - 矢印のラベルは、段と段の間の帯に、行を分けて置く。帯の行の数を、その帯に置くラベルの数以上にするので、
//   ラベルどうし、ラベルと箱は、必ず重ならない。ほかの矢印の線にかからない行があれば、そこを選ぶ。
// 比較の図(compare): 左右に、見出しの箱と項目の箱を並べる。左右の項目は、同じ行どうしを対応させる。
//   上下に積む形(`stacked`)では、左の側を上に、右の側を下に、1 列で並べる(狭い画面で、文字を小さくしないため)。
// 階層の図(hierarchy): 根の箱の中に、子の箱を入れ子にして、上から順に並べる。
// 時系列の図(timeline): 出来事の箱を左から右へ並べ、下に時間の軸を引き、軸の下に期間の箱を置く。
//   上下に積む形では、出来事を上から下へ並べ、左に期間の箱、間に時間の軸を置く。
// 表の変化の図(table-change): 操作の名前を上に置き、前の表と後の表を左右に並べる(間に矢印)。
//   上下に積む形では、前の表、操作の名前と下向きの矢印、後の表の順に並べる。
// 箱の文字は、折り返し、それでも収まらなければ小さくする(`fitText`)。収まらない図は、`diagramProblems` が報告する。
// 文字の幅は、全角を 1 文字分、半角を 0.6 文字分として見積もる(描画の前に文字の大きさを測れないため)。

export type { CompareDiagram, Diagram, FlowDiagram, HierarchyDiagram, TableChangeDiagram, TimelineDiagram };

/** 利用者の操作で動く図の種類。SVG に配置せず、HTML で描く(components/diagram.tsx) */
export const INTERACTIVE_TYPES = ["stepper", "toggle", "decision"] as const;

/** 配置して SVG で描く(静止した)図 */
export type StaticDiagram = Exclude<Diagram, { type: (typeof INTERACTIVE_TYPES)[number] }>;

export const isStaticDiagram = (diagram: Diagram): diagram is StaticDiagram =>
  !(INTERACTIVE_TYPES as readonly string[]).includes(diagram.type);

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

/** 箱の状態: 比較の項目(消える・残る)、階層の箱(起点・範囲内)、表の変化の行と列(消した・足した・変わった) */
export type BoxState = CompareItemState | HierarchyNodeState | TableChangeState;

/**
 * 比較・階層・時系列・表の変化の図の箱。`tone` は、色の役割(画面側で、色に対応させる)。`state` は、箱の状態
 */
export type PlacedBox = Box & {
  tone:
    | "heading-left"
    | "heading-right"
    | "item"
    | "depth-0"
    | "depth-1"
    | "depth-2"
    | "depth-3"
    | "event"
    | "span"
    | "operation"
    | "cell-header"
    | "cell";
  texts: PlacedText[];
  state?: BoxState;
};
/** 箱どうしをつなぐ線(時間の軸、目盛り、表の間の矢印)。`arrow` の線は、終点に矢じりを描く */
export type Connector = { start: Point; end: Point; arrow?: [Point, Point, Point] };
export type BoxLayout = {
  kind: "compare" | "hierarchy" | "timeline" | "table-change";
  width: number;
  height: number;
  boxes: PlacedBox[];
  /** 比較の図の、左右の見出しの間に置く「vs」の位置 */
  versus?: Point;
  /** 時系列・表の変化の図の線 */
  connectors?: Connector[];
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
/** 比較・階層・時系列・表の変化の図の幅(これを基準に、画面の幅に合わせて縮む) */
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

/** 項目の状態を、箱に写す(状態のない項目には、項目を足さない) */
const withState = (state: BoxState | undefined) => (state ? { state } : {});

/**
 * 比較の図: 左右の列に、見出しと項目を並べる。同じ行の左右は、高いほうに高さをそろえる。
 * `stacked` では、左の側を上に、右の側を下に、1 列で積む(列の幅は、左右に並べるときと同じ)。
 */
export function layoutCompare(diagram: CompareDiagram, { stacked = false }: { stacked?: boolean } = {}): BoxLayout {
  const column = (WIDE_WIDTH - COMPARE_GAP) / 2;
  const inner = column - NODE_PADDING_X * 2;
  if (stacked) return layoutCompareStacked(diagram, column, inner);
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
    const items = [diagram.left.items[i], diagram.right.items[i]];
    const fits = items.map((item) => (item ? fitBoxText(item.label, item.note, inner, "label") : null));
    const height = Math.max(NODE_MIN_HEIGHT, ...fits.map((fit) => fit?.height ?? 0));
    fits.forEach((fit, side) => {
      if (!fit) return;
      const box = { x: side === 0 ? leftX : rightX, y, width: column, height };
      boxes.push({ ...box, tone: "item", texts: placeTexts(fit.texts, box), ...withState(items[side]?.state) });
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

/** 比較の図を上下に積む: 左の側(見出しと項目)、「vs」、右の側の順に、1 列で並べる */
function layoutCompareStacked(diagram: CompareDiagram, column: number, inner: number): BoxLayout {
  const boxes: PlacedBox[] = [];
  let y = MARGIN;
  let versus: Point | undefined;
  for (const side of ["left", "right"] as const) {
    if (side === "right") {
      // 左の側の最後の箱の下端から、COMPARE_GAP だけ空けて、その中央に「vs」を置く
      const end = y - ROW_GAP;
      versus = { x: MARGIN + column / 2, y: end + COMPARE_GAP / 2 };
      y = end + COMPARE_GAP;
    }
    const heading = fitBoxText(diagram[side].heading, undefined, inner, "heading");
    const headingBox = { x: MARGIN, y, width: column, height: heading.height };
    boxes.push({ ...headingBox, tone: `heading-${side}`, texts: placeTexts(heading.texts, headingBox) });
    y += heading.height + ROW_GAP;
    for (const item of diagram[side].items) {
      const fit = fitBoxText(item.label, item.note, inner, "label");
      const box = { x: MARGIN, y, width: column, height: Math.max(NODE_MIN_HEIGHT, fit.height) };
      boxes.push({ ...box, tone: "item", texts: placeTexts(fit.texts, box), ...withState(item.state) });
      y += box.height + ROW_GAP;
    }
  }
  return {
    kind: "compare",
    width: column + MARGIN * 2,
    height: y - ROW_GAP + MARGIN,
    boxes,
    ...(versus ? { versus } : {}),
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
      ...withState(node.state),
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

/** 線を足す。同じ始点と終点の線がすでにあれば足さない(接する期間の端の線が、同じ出来事で重なるため) */
function addConnector(connectors: Connector[], line: Connector) {
  const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  if (connectors.some((c) => same(c.start, line.start) && same(c.end, line.end))) return;
  connectors.push(line);
}

/** `start` から `tip` へ向かう矢印の線(線は矢じりの根元で止める) */
function arrowConnector(start: Point, tip: Point): Connector {
  const { base, arrow } = arrowHead(start, tip);
  return { start, end: base, arrow };
}

/** 期間の箱の文字の行の上限(期間の箱は、出来事の間に収めるため、行を多めに許す) */
const SPAN_MAX_LINES = 4;
const TIMELINE_GAP = 16;
/** 時間の軸と、出来事・期間の箱との間 */
const AXIS_GAP = 14;
/** 上下に積む時系列の図の、期間の列の幅 */
const STACKED_SPAN_WIDTH = 96;

/** 期間の名前を、幅 `inner` に収める(題の役。行は `SPAN_MAX_LINES` まで) */
function fitSpanText(label: string, inner: number): { texts: Omit<PlacedText, "x">[]; height: number } {
  const fit = fitText(label, inner, LABEL_FONT_SIZE, SPAN_MAX_LINES);
  const texts = fit.lines.map((text, i) => ({
    text,
    y: NODE_PADDING_Y + LABEL_LINE_HEIGHT * i + LABEL_LINE_HEIGHT / 2,
    fontSize: fit.fontSize,
    role: "label" as const,
    fits: fit.fits,
  }));
  return { texts, height: Math.max(NODE_MIN_HEIGHT, NODE_PADDING_Y * 2 + LABEL_LINE_HEIGHT * fit.lines.length) };
}

/** 期間の箱の文字を、箱の高さの中央にそろえる(題が 1 行でも、期間の箱は高くなることがあるため) */
function centerTexts(texts: Omit<PlacedText, "x">[], box: Box, height: number): PlacedText[] {
  const offset = (box.height - height) / 2;
  return placeTexts(
    texts.map((t) => ({ ...t, y: t.y + offset })),
    box,
  );
}

/**
 * 時系列の図: 出来事を時間の順に並べ、期間の箱を、期間の始まりと終わりの出来事の間に置く。
 * 期間どうしは重ならない(スキーマで検査する)ので、期間は 1 列(1 行)に並ぶ。
 */
export function layoutTimeline(diagram: TimelineDiagram, { stacked = false }: { stacked?: boolean } = {}): BoxLayout {
  const index = new Map(diagram.events.map((event, i) => [event.id, i]));
  const spans = (diagram.spans ?? []).flatMap((span) => {
    const from = index.get(span.from);
    const to = index.get(span.to);
    return from === undefined || to === undefined ? [] : [{ ...span, fromIndex: from, toIndex: to }];
  });
  if (stacked) return layoutTimelineStacked(diagram, spans);

  const n = diagram.events.length;
  const width = (WIDE_WIDTH - TIMELINE_GAP * (n - 1)) / n;
  const fits = diagram.events.map((event) => fitBoxText(event.label, event.note, width - NODE_PADDING_X * 2, "label"));
  const height = Math.max(NODE_MIN_HEIGHT, ...fits.map((fit) => fit.height));
  const boxes: PlacedBox[] = [];
  const connectors: Connector[] = [];
  const centers = diagram.events.map((_, i) => MARGIN + i * (width + TIMELINE_GAP) + width / 2);
  const axisY = MARGIN + height + AXIS_GAP;
  fits.forEach((fit, i) => {
    const box = { x: MARGIN + i * (width + TIMELINE_GAP), y: MARGIN, width, height };
    boxes.push({ ...box, tone: "event", texts: placeTexts(fit.texts, box) });
    connectors.push({ start: { x: centers[i] ?? 0, y: MARGIN + height }, end: { x: centers[i] ?? 0, y: axisY } });
  });
  connectors.push(arrowConnector({ x: MARGIN, y: axisY }, { x: MARGIN + WIDE_WIDTH, y: axisY }));

  const spanY = axisY + AXIS_GAP;
  let bottom = axisY;
  for (const span of spans) {
    const x = centers[span.fromIndex] ?? 0;
    const spanWidth = (centers[span.toIndex] ?? 0) - x;
    const fit = fitSpanText(span.label, spanWidth - NODE_PADDING_X * 2);
    const box = { x, y: spanY, width: spanWidth, height: fit.height };
    boxes.push({ ...box, tone: "span", texts: placeTexts(fit.texts, box) });
    for (const end of [x, x + spanWidth])
      addConnector(connectors, { start: { x: end, y: axisY }, end: { x: end, y: spanY } });
    bottom = Math.max(bottom, spanY + fit.height);
  }
  return { kind: "timeline", width: WIDE_WIDTH + MARGIN * 2, height: bottom + MARGIN, boxes, connectors };
}

/** 時系列の図を上下に積む: 右の列に出来事、左の列に期間、その間に下向きの時間の軸を置く */
function layoutTimelineStacked(
  diagram: TimelineDiagram,
  spans: { label: string; fromIndex: number; toIndex: number }[],
): BoxLayout {
  const column = (WIDE_WIDTH - COMPARE_GAP) / 2;
  const axisX = MARGIN + STACKED_SPAN_WIDTH + AXIS_GAP;
  const eventX = axisX + AXIS_GAP;
  const eventWidth = MARGIN + column - eventX;
  const fits = diagram.events.map((event) =>
    fitBoxText(event.label, event.note, eventWidth - NODE_PADDING_X * 2, "label"),
  );
  const spanFits = spans.map((span) => fitSpanText(span.label, STACKED_SPAN_WIDTH - NODE_PADDING_X * 2));
  // 出来事の間の空き。期間の文字が、始まりと終わりの出来事の中心の間に収まるよう、期間の最後の空きを広げる
  const gaps = diagram.events.map(() => TIMELINE_GAP);
  const centerOf = (i: number) => {
    let y = MARGIN;
    for (let k = 0; k < i; k += 1) y += (fits[k]?.height ?? 0) + (gaps[k] ?? 0);
    return y + (fits[i]?.height ?? 0) / 2;
  };
  spans.forEach((span, i) => {
    const need = (spanFits[i]?.height ?? 0) - (centerOf(span.toIndex) - centerOf(span.fromIndex));
    if (need > 0) gaps[span.toIndex - 1] = (gaps[span.toIndex - 1] ?? 0) + need;
  });

  const boxes: PlacedBox[] = [];
  const connectors: Connector[] = [];
  let y = MARGIN;
  fits.forEach((fit, i) => {
    const box = { x: eventX, y, width: eventWidth, height: fit.height };
    boxes.push({ ...box, tone: "event", texts: placeTexts(fit.texts, box) });
    connectors.push({ start: { x: axisX, y: y + fit.height / 2 }, end: { x: eventX, y: y + fit.height / 2 } });
    y += fit.height + (gaps[i] ?? 0);
  });
  const bottom = y - (gaps.at(-1) ?? 0);
  connectors.push(arrowConnector({ x: axisX, y: MARGIN }, { x: axisX, y: bottom }));
  spans.forEach((span, i) => {
    const fit = spanFits[i];
    if (!fit) return;
    const top = centerOf(span.fromIndex);
    const box = { x: MARGIN, y: top, width: STACKED_SPAN_WIDTH, height: centerOf(span.toIndex) - top };
    boxes.push({ ...box, tone: "span", texts: centerTexts(fit.texts, box, fit.height) });
    for (const end of [box.y, box.y + box.height]) {
      addConnector(connectors, { start: { x: MARGIN + STACKED_SPAN_WIDTH, y: end }, end: { x: axisX, y: end } });
    }
  });
  return { kind: "timeline", width: column + MARGIN * 2, height: bottom + MARGIN, boxes, connectors };
}

/** 表の変化の図のセルの左右の余白と、セルどうしの間 */
const CELL_PADDING_X = 6;
const CELL_GAP = 2;

/** 表(見出しと、列と行のセル)を、左上 (x, y)・幅 `width` に並べ、置いた高さを返す */
function placeTable(
  table: TableChangeDiagram["before"],
  x: number,
  y: number,
  width: number,
  tone: "heading-left" | "heading-right",
  boxes: PlacedBox[],
): number {
  const heading = fitBoxText(table.heading, undefined, width - NODE_PADDING_X * 2, "heading");
  const headingBox = { x, y, width, height: heading.height };
  boxes.push({ ...headingBox, tone, texts: placeTexts(heading.texts, headingBox) });
  let rowY = y + heading.height + ROW_GAP;
  const count = table.columns.length;
  const cellWidth = (width - CELL_GAP * (count - 1)) / count;
  const inner = cellWidth - CELL_PADDING_X * 2;
  const rows: { cells: { label: string; state?: BoxState }[]; tone: "cell-header" | "cell" }[] = [
    { cells: table.columns.map((c) => ({ label: c.label, ...withState(c.state) })), tone: "cell-header" },
    ...table.rows.map((row) => ({
      cells: row.cells.map((label, i) => ({ label, ...withState(row.state ?? table.columns[i]?.state) })),
      tone: "cell" as const,
    })),
  ];
  for (const row of rows) {
    const fits = row.cells.map((cell) => fitBoxText(cell.label, undefined, inner, "label"));
    const height = Math.max(NODE_MIN_HEIGHT, ...fits.map((fit) => fit.height));
    fits.forEach((fit, i) => {
      const box = { x: x + i * (cellWidth + CELL_GAP), y: rowY, width: cellWidth, height };
      boxes.push({ ...box, tone: row.tone, texts: placeTexts(fit.texts, box), ...withState(row.cells[i]?.state) });
    });
    rowY += height + CELL_GAP;
  }
  return rowY - CELL_GAP - y;
}

/**
 * 表の変化の図: 操作の名前を上に置き、前の表(左)と後の表(右)を、間の矢印でつなぐ。
 * `stacked` では、前の表、操作の名前と下向きの矢印、後の表の順に、1 列で積む。
 */
export function layoutTableChange(
  diagram: TableChangeDiagram,
  { stacked = false }: { stacked?: boolean } = {},
): BoxLayout {
  const column = (WIDE_WIDTH - COMPARE_GAP) / 2;
  const boxes: PlacedBox[] = [];
  const connectors: Connector[] = [];
  if (stacked) {
    let y = MARGIN;
    y += placeTable(diagram.before, MARGIN, y, column, "heading-left", boxes) + ROW_GAP;
    // 下向きの矢印の線の上に、操作の名前の箱を重ねる(線は connectors で、箱より先に描く)
    const opWidth = column * 0.75;
    const op = fitBoxText(diagram.operation, undefined, opWidth - NODE_PADDING_X * 2, "label");
    const opBox = { x: MARGIN + (column - opWidth) / 2, y: y + AXIS_GAP, width: opWidth, height: op.height };
    boxes.push({ ...opBox, tone: "operation", texts: placeTexts(op.texts, opBox) });
    const tip = { x: MARGIN + column / 2, y: opBox.y + opBox.height + AXIS_GAP + ARROW_LENGTH };
    connectors.push(arrowConnector({ x: tip.x, y }, tip));
    y = tip.y + ROW_GAP;
    y += placeTable(diagram.after, MARGIN, y, column, "heading-right", boxes);
    return { kind: "table-change", width: column + MARGIN * 2, height: y + MARGIN, boxes, connectors };
  }
  const op = fitBoxText(diagram.operation, undefined, column - NODE_PADDING_X * 2, "label");
  const opBox = { x: MARGIN + (WIDE_WIDTH - column) / 2, y: MARGIN, width: column, height: op.height };
  boxes.push({ ...opBox, tone: "operation", texts: placeTexts(op.texts, opBox) });
  const top = MARGIN + op.height + ROW_GAP * 2;
  const leftHeight = placeTable(diagram.before, MARGIN, top, column, "heading-left", boxes);
  const rightX = MARGIN + column + COMPARE_GAP;
  const rightHeight = placeTable(diagram.after, rightX, top, column, "heading-right", boxes);
  const middle = top + Math.min(leftHeight, rightHeight) / 2;
  connectors.push(arrowConnector({ x: MARGIN + column + ROW_GAP, y: middle }, { x: rightX - ROW_GAP, y: middle }));
  return {
    kind: "table-change",
    width: WIDE_WIDTH + MARGIN * 2,
    height: top + Math.max(leftHeight, rightHeight) + MARGIN,
    boxes,
    connectors,
  };
}

/** 図の種類に応じて配置する。`stacked` は、比較・時系列・表の変化の図を上下に積む(ほかの種類には効かない) */
export function layoutAny(diagram: StaticDiagram, { stacked = false }: { stacked?: boolean } = {}): AnyLayout {
  switch (diagram.type) {
    case "flow":
      return layoutDiagram(diagram);
    case "compare":
      return layoutCompare(diagram, { stacked });
    case "hierarchy":
      return layoutHierarchy(diagram);
    case "timeline":
      return layoutTimeline(diagram, { stacked });
    case "table-change":
      return layoutTableChange(diagram, { stacked });
  }
}

/** 上下に積む形を持つ図の種類(狭い画面で、左右や前後に並べると文字が小さくなりすぎるもの) */
export const STACKABLE_TYPES: readonly StaticDiagram["type"][] = ["compare", "timeline", "table-change"];

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
