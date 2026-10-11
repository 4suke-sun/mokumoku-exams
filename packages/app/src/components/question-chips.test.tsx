// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuestionChips } from "./question-chips.tsx";

const domains = [
  { code: "domain1", name: "分野 1", weight: 50 },
  { code: "domain2", name: "分野 2", weight: 50 },
] as never;

describe("QuestionChips", () => {
  it("分野・難易度・種類を_文字で出し_分野の色を付ける", () => {
    render(
      <QuestionChips
        domains={domains}
        question={{ domain: "domain2", questionType: "multiple", difficulty: "hard" }}
      />,
    );
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["分野: 分野 2", "難易度: むずかしい", "複数選択"]);
    expect(screen.getAllByRole("listitem")[0]?.className).toContain("tone-domain-2");
  });

  it("難易度のない問題と_分野の情報がない_崩れずに種類だけを出す", () => {
    render(<QuestionChips question={{ domain: "domain1", questionType: "single" }} />);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["単一選択"]);
  });
});
