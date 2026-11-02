// @vitest-environment jsdom

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CurriculumFileSchema } from "@mokumoku-exams/data-schema/curriculum-data/schema";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Diagram, FlowDiagram } from "@/lib/diagram-layout.ts";
import { DiagramView, describeDiagram } from "./diagram.tsx";

const diagram: FlowDiagram = {
  type: "flow",
  title: "進め方の流れ",
  nodes: [
    { id: "a", label: "決める" },
    { id: "b", label: "進める" },
    { id: "c", label: "振り返る" },
  ],
  edges: [
    { from: "a", to: "b", label: "先に" },
    { from: "b", to: "c" },
  ],
};

describe("DiagramView", () => {
  it("読み上げ用に_図の題を名前に_矢印の説明を説明にする", () => {
    render(<DiagramView diagram={diagram} id="flow" />);
    const image = screen.getByRole("img", { name: "進め方の流れ" });
    expect(image.getAttribute("aria-describedby")).toBe("flow-desc");
    expect(document.getElementById("flow-desc")?.textContent).toBe(describeDiagram(diagram));
  });

  it("箱のラベルと矢印のラベルを描く_ラベルのない矢印は線と矢じりだけ", () => {
    const { container } = render(<DiagramView diagram={diagram} id="flow" />);
    const texts = [...container.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts).toEqual(["先に", "決める", "進める", "振り返る"]);
    expect(container.querySelectorAll("svg line")).toHaveLength(2);
    expect(container.querySelectorAll("svg polygon")).toHaveLength(2);
  });

  it("色はテーマの役割の色だけを使う(ライトとダークで切り替わる)", () => {
    const { container } = render(<DiagramView diagram={diagram} id="flow" />);
    for (const element of container.querySelectorAll("svg *")) {
      expect(element.getAttribute("fill")).toBeNull();
      expect(element.getAttribute("stroke")).toBeNull();
    }
  });
});

describe("describeDiagram", () => {
  it("矢印ごとに_元と先とラベルを並べる", () => {
    expect(describeDiagram(diagram)).toBe("「決める」から「進める」へ(先に)。「進める」から「振り返る」へ。");
  });
});

describe("比較と階層の図", () => {
  const compare: Diagram = {
    type: "compare",
    title: "ルールベースと AI",
    left: { heading: "ルール", items: [{ label: "明文化できる", note: "規程で書ける" }] },
    right: { heading: "AI", items: [{ label: "例外が多い" }] },
  };
  const hierarchy: Diagram = {
    type: "hierarchy",
    title: "AI の包含関係",
    root: { label: "AI", note: "全体", children: [{ label: "機械学習", children: [{ label: "深層学習" }] }] },
  };

  it("比較の図_見出しと項目と説明を描き_図の種類を示す", () => {
    render(<DiagramView diagram={compare} id="cmp" />);
    const image = screen.getByRole("img", { name: "ルールベースと AI" });
    expect(image.getAttribute("data-diagram-type")).toBe("compare");
    for (const text of ["ルール", "AI", "明文化できる", "規程で書ける", "例外が多い", "vs"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("階層の図_すべての箱の文字を描く", () => {
    render(<DiagramView diagram={hierarchy} id="hie" />);
    expect(screen.getByRole("img", { name: "AI の包含関係" }).getAttribute("data-diagram-type")).toBe("hierarchy");
    for (const text of ["AI", "全体", "機械学習", "深層学習"]) expect(screen.getByText(text)).toBeTruthy();
  });

  it("流れの図の箱の説明_題の下に描く", () => {
    const flow: Diagram = {
      type: "flow",
      title: "流れ",
      nodes: [
        { id: "a", label: "始め", note: "最初のこと" },
        { id: "b", label: "終わり" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    render(<DiagramView diagram={flow} id="fl" />);
    expect(screen.getByText("最初のこと")).toBeTruthy();
  });

  it("色はテーマの役割の色だけを使う(ライトとダーク・リッチとシンプルで切り替わる)", () => {
    const { container } = render(
      <>
        <DiagramView diagram={compare} id="a" />
        <DiagramView diagram={hierarchy} id="b" />
      </>,
    );
    const markup = container.innerHTML;
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(markup).not.toMatch(/(fill|stroke)="(?!none)/);
  });
});

describe("describeDiagram の比較と階層", () => {
  it("比較_左右の見出しと項目を並べる", () => {
    expect(
      describeDiagram({
        type: "compare",
        title: "t",
        left: { heading: "左", items: [{ label: "a", note: "説明" }, { label: "b" }] },
        right: { heading: "右", items: [{ label: "c" }] },
      }),
    ).toBe("左「左」: a(説明)、b。右「右」: c。");
  });

  it("階層_親ごとに子を読む", () => {
    expect(
      describeDiagram({
        type: "hierarchy",
        title: "t",
        root: { label: "親", children: [{ label: "子 1", children: [{ label: "孫" }] }, { label: "子 2" }] },
      }),
    ).toBe("「親」。「親」の中に「子 1」、「子 2」。「子 1」の中に「孫」。");
  });
});

describe("比較の図の項目の状態(消える・残る)", () => {
  const drop: Diagram = {
    type: "compare",
    title: "DROP したとき",
    left: {
      heading: "マネージド",
      items: [
        { label: "メタデータ", state: "removed" },
        { label: "ファイル", state: "removed" },
      ],
    },
    right: {
      heading: "外部",
      items: [
        { label: "メタデータ", state: "removed" },
        { label: "ファイル", note: "ストレージ", state: "kept" },
      ],
    },
  };

  it("消える項目_斜線を引き_残る項目_正解の色の太い枠で強調する", () => {
    const { container } = render(<DiagramView diagram={drop} id="drop" />);
    const removed = container.querySelectorAll('g[data-state="removed"]');
    expect(removed).toHaveLength(3);
    for (const group of removed) {
      expect(group.querySelector("line")?.getAttribute("class")).toContain("motion-strike");
    }
    const kept = container.querySelector('g[data-state="kept"]');
    expect(kept?.querySelector("line")).toBeNull();
    expect(kept?.querySelector("rect")?.getAttribute("class")).toContain("stroke-correct");
    expect(kept?.querySelector("rect")?.getAttribute("stroke-width")).toBe("2.5");
  });

  it("読み上げの説明_状態を項目の後ろに添える", () => {
    expect(describeDiagram(drop)).toBe(
      "左「マネージド」: メタデータ【消える】、ファイル【消える】。右「外部」: メタデータ【消える】、ファイル(ストレージ)【残る】。",
    );
  });

  it("状態のある図_色はテーマの役割の色だけを使う", () => {
    const { container } = render(<DiagramView diagram={drop} id="drop" />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="(?!none)/);
  });

  it("狭い画面で積む指定_左右に並べた図と上下に積んだ図を描き_幅で片方だけを出す", () => {
    const { container } = render(<DiagramView diagram={drop} id="drop" stackOnNarrow />);
    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs.map((svg) => [svg.getAttribute("data-stacked"), svg.getAttribute("class")])).toEqual([
      ["true", "mx-auto h-auto w-full sm:hidden"],
      [null, "mx-auto h-auto w-full hidden sm:block"],
    ]);
    // 上下に積んだ図は、左右に並べた図より幅が狭い(狭い画面で、文字を小さくしない)
    const width = (svg: Element | undefined) => Number(svg?.getAttribute("width"));
    expect(width(svgs[0])).toBeLessThan(width(svgs[1]));
  });

  it("流れの図に積む指定_1 つだけ描く", () => {
    const { container } = render(<DiagramView diagram={diagram} id="flow" stackOnNarrow />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });
});

describe("既存のカリキュラムの図", () => {
  const DATA_DIR = join(import.meta.dirname, "../../../../data");
  const compares = readdirSync(DATA_DIR)
    .filter((n) => /^curriculum\..+\.json$/.test(n))
    .flatMap((name) =>
      CurriculumFileSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, name), "utf8"))).units.flatMap((unit) =>
        unit.sections.flatMap((section) => (section.diagram?.type === "compare" ? [section.diagram] : [])),
      ),
    );

  it("状態のない比較の図_斜線も強調もなく_ふだんの箱と 1 枚の図のまま", () => {
    expect(compares.length).toBeGreaterThan(0);
    for (const compare of compares) {
      const { container, unmount } = render(<DiagramView diagram={compare} id="cur" />);
      expect(container.querySelectorAll("svg")).toHaveLength(1);
      expect(container.querySelector("svg")?.getAttribute("class")).toBe("mx-auto h-auto w-full");
      expect(container.querySelectorAll("svg line")).toHaveLength(0);
      expect(container.querySelectorAll("g[data-state]")).toHaveLength(0);
      for (const rect of container.querySelectorAll("rect")) expect(rect.getAttribute("stroke-width")).toBe("1.5");
      expect(describeDiagram(compare)).not.toMatch(/【/);
      unmount();
    }
  });
});

describe("時系列・表の変化・階層の状態の図", () => {
  const timeline: Diagram = {
    type: "timeline",
    title: "削除から消えるまで",
    events: [
      { id: "drop", label: "DROP TABLE" },
      { id: "limit", label: "保持の期限", note: "既定で 7 日" },
      { id: "purge", label: "ファイルが消える" },
    ],
    spans: [{ from: "drop", to: "limit", label: "戻せる期間" }],
  };
  const change: Diagram = {
    type: "table-change",
    title: "行の削除",
    operation: "DELETE",
    before: {
      heading: "前",
      columns: [{ label: "id" }],
      rows: [{ cells: ["1"] }, { cells: ["2"], state: "removed" }],
    },
    after: {
      heading: "後",
      columns: [{ label: "id" }, { label: "日付", state: "added" }],
      rows: [{ cells: ["1", "x"], state: "changed" }],
    },
  };
  const grant: Diagram = {
    type: "hierarchy",
    title: "権限の継承",
    root: {
      label: "カタログ",
      children: [{ label: "スキーマ", state: "origin", children: [{ label: "表", state: "covered" }] }],
    },
  };

  it("時系列の図_出来事と期間を描き_読み上げで時間の順と期間を伝える", () => {
    render(<DiagramView diagram={timeline} id="tl" />);
    const image = screen.getByRole("img", { name: "削除から消えるまで" });
    expect(image.getAttribute("data-diagram-type")).toBe("timeline");
    for (const text of ["DROP TABLE", "保持の期限", "既定で 7 日", "ファイルが消える", "戻せる期間"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(describeDiagram(timeline)).toBe(
      "時間の順に「DROP TABLE」、「保持の期限(既定で 7 日)」、「ファイルが消える」。「DROP TABLE」から「保持の期限」まで: 戻せる期間。",
    );
  });

  it("表の変化の図_消した行に斜線_足した列と変わった行を状態の色で描き_読み上げで状態を添える", () => {
    const { container } = render(<DiagramView diagram={change} id="tc" />);
    expect(container.querySelector('g[data-state="removed"] line')?.getAttribute("class")).toContain("motion-strike");
    expect(container.querySelector('g[data-state="added"] rect')?.getAttribute("class")).toContain("stroke-correct");
    expect(container.querySelector('g[data-state="changed"] rect')?.getAttribute("class")).toContain("stroke-warn");
    expect(describeDiagram(change)).toBe(
      "操作「DELETE」の前と後。前「前」: 列はid。行は1。2【消した】。後「後」: 列はid、日付【足した】。行は1、x【変わった】。",
    );
  });

  it("階層の図の状態_起点を太い枠で_範囲内を正解の面で描き_読み上げで添える", () => {
    const { container } = render(<DiagramView diagram={grant} id="gr" />);
    expect(container.querySelector('g[data-state="origin"] rect')?.getAttribute("stroke-width")).toBe("3");
    expect(container.querySelector('g[data-state="covered"] rect')?.getAttribute("class")).toContain("fill-correct-bg");
    expect(describeDiagram(grant)).toBe(
      "「カタログ」。「カタログ」の中に「スキーマ」【起点】。「スキーマ」の中に「表」【範囲内】。",
    );
  });

  it("積む指定_時系列と表の変化も、左右に並べた図と上下に積んだ図を描き分ける", () => {
    for (const d of [timeline, change]) {
      const { container, unmount } = render(<DiagramView diagram={d} id="s" stackOnNarrow />);
      expect([...container.querySelectorAll("svg")].map((svg) => svg.getAttribute("data-stacked"))).toEqual([
        "true",
        null,
      ]);
      unmount();
    }
  });

  it("時系列・表の変化・状態のある階層の図_色はテーマの役割の色だけを使う", () => {
    const { container } = render(
      <>
        <DiagramView diagram={timeline} id="a" />
        <DiagramView diagram={change} id="b" />
        <DiagramView diagram={grant} id="c" />
      </>,
    );
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(container.innerHTML).not.toMatch(/(fill|stroke)="(?!none)/);
  });
});
