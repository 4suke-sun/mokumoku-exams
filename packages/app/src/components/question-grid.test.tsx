// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestionGrid } from "./question-grid.tsx";

describe("QuestionGrid", () => {
  it("正誤を渡さない_回答済みと未回答だけを示し_凡例に正誤を出さない", () => {
    render(<QuestionGrid total={2} current={0} answered={[true, false]} flagged={[false, true]} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "問題 1(回答済み)" }).textContent).toBe("1");
    expect(screen.getByRole("button", { name: "問題 2(未回答、見直し)" })).toBeTruthy();
    expect(screen.getByText("1 / 2 問回答")).toBeTruthy();
    expect(screen.getByText("塗り: 回答済み / 点: 見直し / 枠: 今の問題")).toBeTruthy();
  });

  it("正誤を渡し_今の問題がない_マスに ○・× を示し_要約と凡例を合わせる", () => {
    render(
      <QuestionGrid
        total={3}
        answered={[true, true, false]}
        flagged={[false, false, false]}
        verdicts={[true, false, undefined]}
        summary="1 / 3 問正解"
        onSelect={vi.fn()}
      />,
    );
    const correct = screen.getByRole("button", { name: "問題 1(正解)" });
    expect(correct.className).toContain("q-cell-correct");
    expect(correct.textContent).toBe("○1");
    const incorrect = screen.getByRole("button", { name: "問題 2(不正解)" });
    expect(incorrect.className).toContain("q-cell-incorrect");
    expect(incorrect.textContent).toBe("×2");
    expect(screen.getByRole("button", { name: "問題 3(未回答)" }).textContent).toBe("3");
    expect(screen.getByText("1 / 3 問正解")).toBeTruthy();
    expect(screen.getByText("○: 正解 / ×: 不正解 / 塗り: 回答済み / 点: 見直し")).toBeTruthy();
    expect(screen.getAllByRole("button").some((b) => b.getAttribute("aria-current") === "step")).toBe(false);
  });
});
