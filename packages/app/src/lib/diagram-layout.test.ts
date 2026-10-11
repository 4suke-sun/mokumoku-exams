import { describe, expect, it } from "vitest";
import sample from "../../../../data/curriculum.sample.json" with { type: "json" };
import {
  type Box,
  type Diagram,
  type DiagramLayout,
  layoutDiagram,
  overlaps,
  segmentCrossesBox,
  textWidth,
} from "./diagram-layout.ts";

const node = (id: string, label = id) => ({ id, label });
const edge = (from: string, to: string, label?: string) => ({ from, to, ...(label ? { label } : {}) });

/** 配置の約束: 箱どうし、ラベルどうし、ラベルと箱が重ならず、すべてが図の範囲に収まる */
function expectNoOverlap(layout: DiagramLayout, diagram: Diagram) {
  const labels = layout.edges.flatMap((e) => (e.labelBox ? [e.labelBox] : []));
  expect(labels).toHaveLength(diagram.edges.filter((e) => e.label).length);
  layout.nodes.forEach((a, i) => {
    for (const b of layout.nodes.slice(i + 1)) expect(overlaps(a, b), `${a.id} と ${b.id}`).toBe(false);
  });
  labels.forEach((a, i) => {
    for (const b of labels.slice(i + 1)) expect(overlaps(a, b), "ラベルどうし").toBe(false);
    for (const n of layout.nodes) expect(overlaps(a, n), `ラベルと ${n.id}`).toBe(false);
  });
  for (const box of [...layout.nodes, ...labels]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
    expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
  }
}

/** ラベルの中心が、自分の矢印の線の上にある(どの矢印のラベルかが分かる) */
function expectLabelsOnEdges(layout: DiagramLayout) {
  for (const e of layout.edges) {
    if (!e.labelBox) continue;
    const cx = e.labelBox.x + e.labelBox.width / 2;
    const cy = e.labelBox.y + e.labelBox.height / 2;
    const cross = (e.end.x - e.start.x) * (cy - e.start.y) - (e.end.y - e.start.y) * (cx - e.start.x);
    const distance = Math.abs(cross) / Math.hypot(e.end.x - e.start.x, e.end.y - e.start.y);
    expect(distance).toBeLessThan(0.001);
    expect(cy).toBeGreaterThan(Math.min(e.start.y, e.end.y));
    expect(cy).toBeLessThan(Math.max(e.start.y, e.end.y));
  }
}

function layerOf(layout: DiagramLayout, id: string): number {
  return layout.nodes.find((n) => n.id === id)?.layer ?? -1;
}

/** 決まった種から作る、閉路のない図(箱は 2〜20、矢印は最大 40、ラベルの長さはまちまち) */
function randomDiagrams(count: number): Diagram[] {
  let seed = 20261011;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: count }, () => {
    const size = 2 + Math.floor(next() * 19);
    const nodes = Array.from({ length: size }, (_, i) => node(`n${i}`, "箱".repeat(1 + Math.floor(next() * 10))));
    const edges: Diagram["edges"] = [];
    const seen = new Set<string>();
    for (let k = 0; k < 40; k += 1) {
      const a = Math.floor(next() * size);
      const b = Math.floor(next() * size);
      // 番号の小さい箱から大きい箱へだけ引くので、閉路にならない
      const [from, to] = a < b ? [a, b] : [b, a];
      if (from === to || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`);
      const label = next() < 0.7 ? "ラ".repeat(1 + Math.floor(next() * 12)) : undefined;
      edges.push(edge(`n${from}`, `n${to}`, label));
    }
    if (edges.length === 0) edges.push(edge("n0", "n1", "次"));
    return { title: "図", nodes, edges };
  });
}

describe("文字の幅と重なりの判定", () => {
  it("全角は 1 文字分_半角は 0.6 文字分として見積もる", () => {
    expect(textWidth("あい", 10)).toBe(20);
    expect(textWidth("ab", 10)).toBe(12);
    expect(textWidth("", 10)).toBe(0);
  });

  it("箱の重なり_辺が接するだけなら重ならない", () => {
    const a: Box = { x: 0, y: 0, width: 10, height: 10 };
    expect(overlaps(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(overlaps(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 10, width: 10, height: 10 })).toBe(false);
    expect(overlaps(a, { x: 2, y: 2, width: 2, height: 2 })).toBe(true);
  });

  it("線分と箱_内側を通るときだけ交わるとする", () => {
    const box: Box = { x: 10, y: 10, width: 10, height: 10 };
    expect(segmentCrossesBox({ x: 0, y: 15 }, { x: 30, y: 15 }, box)).toBe(true);
    expect(segmentCrossesBox({ x: 0, y: 0 }, { x: 30, y: 30 }, box)).toBe(true);
    expect(segmentCrossesBox({ x: 0, y: 0 }, { x: 5, y: 5 }, box)).toBe(false);
    expect(segmentCrossesBox({ x: 0, y: 25 }, { x: 30, y: 25 }, box)).toBe(false);
    expect(segmentCrossesBox({ x: 15, y: 0 }, { x: 15, y: 9 }, box)).toBe(false);
  });
});

describe("図解の配置", () => {
  it("段組み_矢印の先の箱は、元の箱より下の段に置く", () => {
    const diagram: Diagram = {
      title: "図",
      nodes: [node("d"), node("a"), node("b"), node("c")],
      edges: [edge("a", "b"), edge("b", "c"), edge("a", "c"), edge("c", "d")],
    };
    const layout = layoutDiagram(diagram);
    expect(["a", "b", "c", "d"].map((id) => layerOf(layout, id))).toEqual([0, 1, 2, 3]);
    for (const e of layout.edges) {
      const from = layout.nodes.find((n) => n.id === e.from);
      const to = layout.nodes.find((n) => n.id === e.to);
      expect((to?.y ?? 0) > (from?.y ?? 0)).toBe(true);
      // 矢じりの先端は、先の箱の上端の真ん中
      expect(e.arrow[0]).toEqual({ x: (to?.x ?? 0) + (to?.width ?? 0) / 2, y: to?.y });
    }
    expectNoOverlap(layout, diagram);
  });

  it("同じ段の箱_横に並べ、段ごとに中央にそろえる", () => {
    const diagram: Diagram = {
      title: "図",
      nodes: [node("top", "上の箱"), node("l", "左"), node("r", "右")],
      edges: [edge("top", "l"), edge("top", "r")],
    };
    const layout = layoutDiagram(diagram);
    const [top, l, r] = ["top", "l", "r"].map((id) => layout.nodes.find((n) => n.id === id));
    expect(l?.y).toBe(r?.y);
    expect((l?.x ?? 0) + (l?.width ?? 0)).toBeLessThan(r?.x ?? 0);
    const center = (n?: Box) => (n?.x ?? 0) + (n?.width ?? 0) / 2;
    expect(center(top)).toBeCloseTo((l?.x ?? 0) / 2 + ((r?.x ?? 0) + (r?.width ?? 0)) / 2, 6);
  });

  it("1 つの箱から多くのラベルつきの矢印が出る_ラベルが重ならない", () => {
    const children = Array.from({ length: 8 }, (_, i) => node(`c${i}`, "子"));
    const diagram: Diagram = {
      title: "図",
      nodes: [node("root", "親"), ...children],
      edges: children.map((c) => edge("root", c.id, "長めのラベルです")),
    };
    const layout = layoutDiagram(diagram);
    expectNoOverlap(layout, diagram);
    expectLabelsOnEdges(layout);
  });

  it("交差する矢印・段を飛ばす矢印のラベル_重ならない", () => {
    const diagram: Diagram = {
      title: "図",
      nodes: [node("a"), node("b"), node("x"), node("y"), node("z")],
      edges: [
        edge("a", "x", "一"),
        edge("a", "y", "二"),
        edge("a", "z", "三"),
        edge("b", "x", "四"),
        edge("b", "y", "五"),
        edge("b", "z", "六"),
        edge("x", "y", "七"),
        edge("a", "b", "八"),
      ],
    };
    const layout = layoutDiagram(diagram);
    expectNoOverlap(layout, diagram);
    expectLabelsOnEdges(layout);
  });

  it("サンプルの図_ラベルが重ならず_ほかの矢印の線にもかからない", () => {
    const diagram = sample.units
      .flatMap((u) => u.sections)
      .flatMap((s) => ("diagram" in s && s.diagram ? [s.diagram as Diagram] : []))[0];
    if (!diagram) throw new Error("サンプルに図がありません");
    const layout = layoutDiagram(diagram);
    expectNoOverlap(layout, diagram);
    expectLabelsOnEdges(layout);
    for (const e of layout.edges) {
      const box = e.labelBox;
      if (!box) continue;
      for (const other of layout.edges) {
        if (other !== e) expect(segmentCrossesBox(other.start, other.end, box)).toBe(false);
      }
    }
  });

  it("決まった種から作った 200 個の図_どれも重ならない", () => {
    for (const diagram of randomDiagrams(200)) {
      const layout = layoutDiagram(diagram);
      expectNoOverlap(layout, diagram);
      expectLabelsOnEdges(layout);
      for (const e of diagram.edges) expect(layerOf(layout, e.to)).toBeGreaterThan(layerOf(layout, e.from));
    }
  });

  it("同じ入力_同じ配置になる", () => {
    const [diagram] = randomDiagrams(1);
    if (!diagram) throw new Error("図がありません");
    expect(layoutDiagram(diagram)).toEqual(layoutDiagram(diagram));
  });

  it("閉路のある図(検査で落ちるため通常は来ない)_止まらずに、重ならないように描く", () => {
    const diagram: Diagram = {
      title: "図",
      nodes: [node("s"), node("a"), node("b"), node("c")],
      edges: [edge("s", "a", "入る"), edge("a", "b", "次"), edge("b", "c", "次"), edge("c", "a", "戻る")],
    };
    const layout = layoutDiagram(diagram);
    expect(new Set(layout.nodes.map((n) => n.layer)).size).toBe(4);
    expectNoOverlap(layout, diagram);
    expectLabelsOnEdges(layout);
  });
});
