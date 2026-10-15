// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { judgeFreeText } from "@/lib/free-text.ts";
import { RubricView } from "./rubric-view.tsx";

const rubric = {
  passingPoints: 2,
  criteria: [
    { name: "観点 A", points: 2, keywords: ["暗号化", "KMS"] },
    { name: "観点 B", points: 1, keywords: ["監査"] },
  ],
};

afterEach(() => {
  cleanup();
});

const rows = () => screen.getAllByRole("listitem").map((li) => li.textContent);

describe("RubricView", () => {
  it("観点_見出しに合格点を出し_観点ごとの配点を並べる", () => {
    render(<RubricView rubric={rubric} mode="criteria" />);
    expect(screen.getByRole("heading").textContent).toBe("採点の観点(合格点 2 点)");
    expect(rows()).toEqual(["観点 A2 点", "観点 B1 点"]);
  });

  it("キーワードつき_判定に使うキーワードを添える", () => {
    render(<RubricView rubric={rubric} mode="keywords" />);
    expect(screen.getByRole("heading").textContent).toBe("採点基準(合格点 2 点)");
    expect(rows()[0]).toBe("観点 A(2 点): 暗号化、KMS");
  });

  it("判定つき_満たした観点だけに点を付ける", () => {
    render(<RubricView rubric={rubric} mode="judged" judgement={judgeFreeText(rubric, "KMS で暗号化する")} />);
    expect(screen.getByRole("heading").textContent).toBe("観点ごとの判定");
    expect(rows()).toEqual(["○ 満たしている観点 A2 / 2 点", "× 満たしていない観点 B0 / 1 点"]);
  });
});
