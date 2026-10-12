// @vitest-environment jsdom
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
