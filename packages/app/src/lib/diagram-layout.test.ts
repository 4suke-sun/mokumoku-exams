import { describe, expect, it } from "vitest";
import sample from "../../../../data/curriculum.ex-smp-xx.json" with { type: "json" };
import {
  type Box,
  type CompareDiagram,
  type DiagramLayout,
  diagramProblems,
  type FlowDiagram,
  fitText,
  type HierarchyDiagram,
  layoutAny,
  layoutCompare,
  layoutDiagram,
  layoutHierarchy,
  layoutTableChange,
  layoutTimeline,
  MAX_FLOW_WIDTH,
  MIN_FONT_SIZE,
  overlaps,
  type PlacedBox,
  segmentCrossesBox,
  type TableChangeDiagram,
  type TimelineDiagram,
  textWidth,
  wrapText,
} from "./diagram-layout.ts";

const node = (id: string, label = id) => ({ id, label });
const edge = (from: string, to: string, label?: string) => ({ from, to, ...(label ? { label } : {}) });

/** 配置の約束: 箱どうし、ラベルどうし、ラベルと箱が重ならず、すべてが図の範囲に収まる */
function expectNoOverlap(layout: DiagramLayout, diagram: FlowDiagram) {
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
function randomDiagrams(count: number): FlowDiagram[] {
  let seed = 20261011;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: count }, () => {
    const size = 2 + Math.floor(next() * 19);
    const nodes = Array.from({ length: size }, (_, i) => node(`n${i}`, "箱".repeat(1 + Math.floor(next() * 10))));
    const edges: FlowDiagram["edges"] = [];
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
    return { type: "flow" as const, title: "図", nodes, edges };
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
    const diagram: FlowDiagram = {
      type: "flow",
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
    const diagram: FlowDiagram = {
      type: "flow",
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
    const diagram: FlowDiagram = {
      type: "flow",
      title: "図",
      nodes: [node("root", "親"), ...children],
      edges: children.map((c) => edge("root", c.id, "長めのラベルです")),
    };
    const layout = layoutDiagram(diagram);
    expectNoOverlap(layout, diagram);
    expectLabelsOnEdges(layout);
  });

  it("交差する矢印・段を飛ばす矢印のラベル_重ならない", () => {
    const diagram: FlowDiagram = {
      type: "flow",
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
      .flatMap((s) => ("diagram" in s && s.diagram ? [s.diagram as FlowDiagram] : []))[0];
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
    const diagram: FlowDiagram = {
      type: "flow",
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

describe("文字の折り返しと縮小", () => {
  it("幅に収まる文字_折り返さず元の大きさのまま", () => {
    expect(fitText("短い", 200, 14, 2)).toEqual({ lines: ["短い"], fontSize: 14, fits: true });
  });

  it("幅を超える文字_行数の上限の中で折り返す", () => {
    const fit = fitText("あ".repeat(20), 150, 14, 2);
    expect(fit.fits).toBe(true);
    expect(fit.lines.length).toBeLessThanOrEqual(2);
    expect(fit.lines.join("")).toBe("あ".repeat(20));
  });

  it("折り返しでも収まらない文字_小さくして収める", () => {
    // 14px で 3 行になる長さは、2 行までの上限では、文字を縮めないと収まらない
    const fit = fitText("あ".repeat(24), 150, 14, 2);
    expect(fit.fits).toBe(true);
    expect(fit.fontSize).toBeLessThan(14);
    expect(fit.fontSize).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
  });

  it("最小の大きさでも収まらない文字_収まらないと報告する", () => {
    const fit = fitText("あ".repeat(200), 100, 14, 2);
    expect(fit.fits).toBe(false);
    expect(fit.fontSize).toBe(MIN_FONT_SIZE);
  });

  it("句読点_行の先頭に置かず_前の行の末尾に付ける", () => {
    const lines = wrapText("あいうえお、かきくけこ。", textWidthOf("あいうえお"), 14);
    expect(lines.every((line) => !"、。".includes(line[0] ?? ""))).toBe(true);
    expect(lines.join("")).toBe("あいうえお、かきくけこ。");
  });
});

function textWidthOf(text: string): number {
  return textWidth(text, 14);
}

describe("流れの図の箱の説明", () => {
  const flow: FlowDiagram = {
    type: "flow",
    title: "説明つき",
    nodes: [
      { id: "a", label: "始め", note: "最初に行うこと。目的をはっきりさせる" },
      { id: "b", label: "終わり" },
    ],
    edges: [{ from: "a", to: "b", label: "次に" }],
  };

  it("説明のある箱_題の下に説明を置き_高さが増える", () => {
    const layout = layoutDiagram(flow);
    const [a, b] = [layout.nodes.find((n) => n.id === "a"), layout.nodes.find((n) => n.id === "b")];
    expect(a?.texts.map((t) => t.role)).toContain("note");
    expect(b?.texts.map((t) => t.role)).toEqual(["label"]);
    expect(a?.height ?? 0).toBeGreaterThan(b?.height ?? 0);
    expectNoOverlap(layout, flow);
  });

  it("説明のない箱だけの図_これまでと同じ高さ", () => {
    const layout = layoutDiagram({ ...flow, nodes: flow.nodes.map(({ note: _note, ...n }) => n) });
    expect(layout.nodes.every((n) => n.height === 36)).toBe(true);
  });

  it("箱の文字_すべて箱の中に収まる", () => {
    expect(diagramProblems(layoutDiagram(flow))).toEqual([]);
  });

  it("1 つの段に箱が多すぎる図_広すぎると報告する", () => {
    const nodes = [{ id: "root", label: "根" }, ...Array.from({ length: 8 }, (_, i) => node(`n${i}`, "あ".repeat(12)))];
    const edges = nodes.slice(1).map((n) => edge("root", n.id));
    const layout = layoutDiagram({ type: "flow", title: "広い", nodes, edges });
    expect(layout.width).toBeGreaterThan(MAX_FLOW_WIDTH);
    expect(diagramProblems(layout).some((p) => p.includes("広すぎます"))).toBe(true);
  });
});

describe("比較の図の配置", () => {
  const compare: CompareDiagram = {
    type: "compare",
    title: "比較",
    left: {
      heading: "左の見出し",
      items: [{ label: "項目 1", note: "説明" }, { label: "項目 2" }, { label: "項目 3" }],
    },
    right: { heading: "右の見出し", items: [{ label: "あ".repeat(20), note: "い".repeat(40) }, { label: "項目 B" }] },
  };

  it("左右に見出しを並べ_その下に項目を行ごとに並べる", () => {
    const layout = layoutCompare(compare);
    expect(layout.kind).toBe("compare");
    const tones = layout.boxes.map((b) => b.tone);
    expect(tones.slice(0, 2)).toEqual(["heading-left", "heading-right"]);
    expect(tones.filter((t) => t === "item")).toHaveLength(5);
    const [left, right] = [layout.boxes[0], layout.boxes[1]];
    expect((left?.x ?? 0) + (left?.width ?? 0)).toBeLessThan(right?.x ?? 0);
  });

  it("箱どうしが重ならず_すべて図の範囲に収まる", () => {
    const layout = layoutCompare(compare);
    layout.boxes.forEach((a, i) => {
      for (const b of layout.boxes.slice(i + 1)) expect(overlaps(a, b), `${i}`).toBe(false);
      expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
      expect(a.y + a.height).toBeLessThanOrEqual(layout.height);
    });
  });

  it("同じ行の左右_高さをそろえる", () => {
    const layout = layoutCompare(compare);
    const items = layout.boxes.filter((b) => b.tone === "item");
    // 1 行目は、右が長い文字で高い。左も同じ高さにそろう
    expect(items[0]?.height).toBe(items[1]?.height);
  });

  it("長い文字_折り返して収め_問題なし", () => {
    expect(diagramProblems(layoutCompare(compare))).toEqual([]);
  });

  it("「vs」の位置_左右の見出しの間", () => {
    const layout = layoutCompare(compare);
    const [left, right] = [layout.boxes[0], layout.boxes[1]];
    expect(layout.versus?.x).toBeGreaterThan((left?.x ?? 0) + (left?.width ?? 0));
    expect(layout.versus?.x).toBeLessThan(right?.x ?? 0);
  });
});

describe("階層の図の配置", () => {
  const hierarchy: HierarchyDiagram = {
    type: "hierarchy",
    title: "階層",
    root: {
      label: "根",
      note: "いちばん外側",
      children: [{ label: "子 1", children: [{ label: "孫 1" }, { label: "孫 2", note: "説明" }] }, { label: "子 2" }],
    },
  };

  it("子の箱_親の箱の中に収まり_子どうしは重ならない", () => {
    const layout = layoutHierarchy(hierarchy);
    expect(layout.kind).toBe("hierarchy");
    const [root, child1, grand1, grand2, child2] = layout.boxes;
    const inside = (inner?: Box, outer?: Box) =>
      !!inner &&
      !!outer &&
      inner.x >= outer.x &&
      inner.y >= outer.y &&
      inner.x + inner.width <= outer.x + outer.width &&
      inner.y + inner.height <= outer.y + outer.height;
    expect(inside(child1, root)).toBe(true);
    expect(inside(child2, root)).toBe(true);
    expect(inside(grand1, child1)).toBe(true);
    expect(inside(grand2, child1)).toBe(true);
    expect(overlaps(child1 as Box, child2 as Box)).toBe(false);
    expect(overlaps(grand1 as Box, grand2 as Box)).toBe(false);
  });

  it("入れ子の深さ_色の段階に対応する", () => {
    expect(layoutHierarchy(hierarchy).boxes.map((b) => b.tone)).toEqual([
      "depth-0",
      "depth-1",
      "depth-2",
      "depth-2",
      "depth-1",
    ]);
  });

  it("題と説明_箱の上の端に寄せる(子が並ぶので中央にしない)", () => {
    const [root] = layoutHierarchy(hierarchy).boxes;
    const first = root?.texts[0];
    expect((first?.y ?? 99) - (root?.y ?? 0)).toBeLessThan(20);
  });

  it("文字が収まる_問題なし", () => {
    expect(diagramProblems(layoutHierarchy(hierarchy))).toEqual([]);
  });
});

describe("layoutAny", () => {
  it("図の種類に応じた配置を返す", () => {
    expect(layoutAny({ type: "flow", title: "f", nodes: [node("a"), node("b")], edges: [edge("a", "b")] }).kind).toBe(
      "flow",
    );
    expect(
      layoutAny({
        type: "compare",
        title: "c",
        left: { heading: "l", items: [{ label: "x" }] },
        right: { heading: "r", items: [{ label: "y" }] },
      }).kind,
    ).toBe("compare");
    expect(layoutAny({ type: "hierarchy", title: "h", root: { label: "r" } }).kind).toBe("hierarchy");
  });
});

describe("比較の図を上下に積む配置", () => {
  const compare: CompareDiagram = {
    type: "compare",
    title: "比較",
    left: { heading: "左", items: [{ label: "項目 1", state: "removed" }, { label: "項目 2" }] },
    right: { heading: "右", items: [{ label: "あ".repeat(20), note: "い".repeat(40), state: "kept" }] },
  };

  it("左の側を上に_右の側を下に_1 列で並べ_重ならず範囲に収まる", () => {
    const layout = layoutCompare(compare, { stacked: true });
    expect(layout.boxes.map((b) => b.tone)).toEqual(["heading-left", "item", "item", "heading-right", "item"]);
    expect(new Set(layout.boxes.map((b) => b.x)).size).toBe(1);
    layout.boxes.forEach((a, i) => {
      for (const b of layout.boxes.slice(i + 1)) expect(overlaps(a, b), `${i}`).toBe(false);
    });
    expect(diagramProblems(layout)).toEqual([]);
    expect(layout.width).toBeLessThan(layoutCompare(compare).width);
  });

  it("「vs」の位置_左の側と右の側の間", () => {
    const layout = layoutCompare(compare, { stacked: true });
    const lastLeft = layout.boxes[2];
    const rightHeading = layout.boxes[3];
    expect(layout.versus?.y).toBeGreaterThan((lastLeft?.y ?? 0) + (lastLeft?.height ?? 0));
    expect(layout.versus?.y).toBeLessThan(rightHeading?.y ?? 0);
  });

  it("項目の状態_左右に並べても積んでも、箱に写す", () => {
    for (const stacked of [false, true]) {
      const states = layoutCompare(compare, { stacked }).boxes.map((b) => b.state);
      expect(states.filter(Boolean).sort()).toEqual(["kept", "removed"]);
    }
  });
});

/** 箱どうしが重ならず、図の範囲に収まり、文字が箱に収まる */
function expectClean(layout: { boxes: PlacedBox[]; width: number; height: number }, label: string) {
  layout.boxes.forEach((a, i) => {
    for (const b of layout.boxes.slice(i + 1)) expect(overlaps(a, b), `${label} ${i}`).toBe(false);
  });
  expect(diagramProblems(layout as Parameters<typeof diagramProblems>[0])).toEqual([]);
}

describe("時系列の図の配置", () => {
  const timeline: TimelineDiagram = {
    type: "timeline",
    title: "削除から消えるまで",
    events: [
      { id: "drop", label: "DROP TABLE" },
      { id: "limit", label: "保持の期限", note: "既定で 7 日" },
      { id: "purge", label: "ファイルが消える" },
      { id: "late", label: "UNDROP は失敗" },
    ],
    spans: [
      { from: "drop", to: "limit", label: "UNDROP で戻せる期間" },
      { from: "limit", to: "late", label: "戻せない" },
    ],
  };

  it("左右に並べる_出来事は時間の順に左から右_期間は始まりと終わりの出来事の間", () => {
    const layout = layoutTimeline(timeline);
    const events = layout.boxes.filter((b) => b.tone === "event");
    const spans = layout.boxes.filter((b) => b.tone === "span");
    // 題は折り返すことがあるので、題の行をつないで比べる
    const label = (b: PlacedBox) =>
      b.texts
        .filter((t) => t.role === "label")
        .map((t) => t.text)
        .join("");
    expect(events.map(label)).toEqual(["DROP TABLE", "保持の期限", "ファイルが消える", "UNDROP は失敗"]);
    expect(events.map((b) => b.x)).toEqual([...events.map((b) => b.x)].sort((a, b) => a - b));
    const center = (b: PlacedBox | undefined) => (b?.x ?? 0) + (b?.width ?? 0) / 2;
    expect(spans[0]?.x).toBeCloseTo(center(events[0]));
    expect((spans[0]?.x ?? 0) + (spans[0]?.width ?? 0)).toBeCloseTo(center(events[1]));
    expect(Math.min(...spans.map((b) => b.y))).toBeGreaterThan(Math.max(...events.map((b) => b.y + b.height)));
    expect(layout.connectors?.some((c) => c.arrow)).toBe(true);
    expectClean(layout, "wide");
  });

  it("上下に積む_出来事は上から下_期間は左の列で始まりと終わりの出来事の中心の間_幅は狭い", () => {
    const layout = layoutTimeline(timeline, { stacked: true });
    const events = layout.boxes.filter((b) => b.tone === "event");
    const spans = layout.boxes.filter((b) => b.tone === "span");
    expect(events.map((b) => b.y)).toEqual([...events.map((b) => b.y)].sort((a, b) => a - b));
    const middle = (b: PlacedBox | undefined) => (b?.y ?? 0) + (b?.height ?? 0) / 2;
    expect(spans[0]?.y).toBeCloseTo(middle(events[0]));
    expect((spans[0]?.y ?? 0) + (spans[0]?.height ?? 0)).toBeCloseTo(middle(events[1]));
    expect(Math.max(...spans.map((b) => b.x + b.width))).toBeLessThan(Math.min(...events.map((b) => b.x)));
    expect(layout.width).toBeLessThan(layoutTimeline(timeline).width);
    expectClean(layout, "stacked");
  });

  it("端が接する期間_共有する出来事の線を重ねて描かない(広い形も積む形も)", () => {
    const touching: TimelineDiagram = {
      ...timeline,
      spans: [
        { from: "drop", to: "limit", label: "前半" },
        { from: "limit", to: "late", label: "後半" },
      ],
    };
    for (const stacked of [false, true]) {
      const lines = layoutTimeline(touching, { stacked }).connectors ?? [];
      const keys = lines.map((c) => `${c.start.x},${c.start.y}>${c.end.x},${c.end.y}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("期間のない時系列_出来事と軸だけを描く", () => {
    const layout = layoutTimeline({ ...timeline, spans: undefined });
    expect(layout.boxes.every((b) => b.tone === "event")).toBe(true);
    expectClean(layout, "nospan");
  });
});

describe("表の変化の図の配置", () => {
  const change: TableChangeDiagram = {
    type: "table-change",
    title: "MERGE INTO の前と後",
    operation: "MERGE INTO",
    before: {
      heading: "対象の表(前)",
      columns: [{ label: "id" }, { label: "名前" }],
      rows: [{ cells: ["1", "A"] }, { cells: ["2", "B"], state: "removed" }],
    },
    after: {
      heading: "対象の表(後)",
      columns: [{ label: "id" }, { label: "名前" }, { label: "メール", state: "added" }],
      rows: [
        { cells: ["1", "A2", "NULL"], state: "changed" },
        { cells: ["3", "C", "c@x"], state: "added" },
      ],
    },
  };

  it("左右に並べる_操作の名前を上に_前の表を左_後の表を右_状態を箱に写す", () => {
    const layout = layoutTableChange(change);
    const op = layout.boxes.find((b) => b.tone === "operation");
    expect(op?.texts[0]?.text).toBe("MERGE INTO");
    const left = layout.boxes.find((b) => b.tone === "heading-left");
    const right = layout.boxes.find((b) => b.tone === "heading-right");
    expect(left?.x ?? 0).toBeLessThan(right?.x ?? 0);
    expect(op?.y ?? 0).toBeLessThan(left?.y ?? 0);
    const states = layout.boxes.map((b) => b.state).filter(Boolean);
    // 消した行の 2 セル、変わった行の 3 セル、足した行の 3 セル、足した列の見出し
    expect(states.filter((s) => s === "removed")).toHaveLength(2);
    expect(states.filter((s) => s === "changed")).toHaveLength(3);
    expect(states.filter((s) => s === "added")).toHaveLength(4);
    expect(layout.connectors?.filter((c) => c.arrow)).toHaveLength(1);
    expectClean(layout, "wide");
  });

  it("上下に積む_前の表_操作の名前_後の表の順_幅は狭い", () => {
    const layout = layoutTableChange(change, { stacked: true });
    const y = (tone: PlacedBox["tone"]) => layout.boxes.find((b) => b.tone === tone)?.y ?? 0;
    expect(y("heading-left")).toBeLessThan(y("operation"));
    expect(y("operation")).toBeLessThan(y("heading-right"));
    expect(layout.width).toBeLessThan(layoutTableChange(change).width);
    expectClean(layout, "stacked");
  });
});

describe("階層の図の箱の状態", () => {
  it("起点と範囲内_箱に写す", () => {
    const layout = layoutHierarchy({
      type: "hierarchy",
      title: "権限",
      root: {
        label: "カタログ",
        children: [{ label: "スキーマ", state: "origin", children: [{ label: "表", state: "covered" }] }],
      },
    });
    expect(layout.boxes.map((b) => b.state)).toEqual([undefined, "origin", "covered"]);
  });
});

describe("layoutAny の時系列と表の変化", () => {
  it("時系列と表の変化_種類に応じた配置を返し_積む指定が効く", () => {
    const t: TimelineDiagram = {
      type: "timeline",
      title: "t",
      events: [
        { id: "a", label: "a" },
        { id: "b", label: "b" },
      ],
    };
    expect(layoutAny(t).kind).toBe("timeline");
    expect(layoutAny(t, { stacked: true }).width).toBeLessThan(layoutAny(t).width);
    const c: TableChangeDiagram = {
      type: "table-change",
      title: "c",
      operation: "op",
      before: { heading: "前", columns: [{ label: "x" }], rows: [{ cells: ["1"] }] },
      after: { heading: "後", columns: [{ label: "x" }], rows: [{ cells: ["2"] }] },
    };
    expect(layoutAny(c).kind).toBe("table-change");
  });
});
