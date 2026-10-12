// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitSummary } from "./unit-summary.tsx";

describe("UnitSummary", () => {
  it("要約がある_見出しと箇条書きで_この順に出す", () => {
    render(<UnitSummary summary={["要点 1", "**強調**した要点 2"]} />);
    const list = screen.getByRole("region", { name: "この単元の要点" });
    // ✓ は飾り(aria-hidden)。文字だけでも要点として読める
    const items = Array.from(list.querySelectorAll("li"));
    expect(items.map((li) => li.textContent)).toEqual(["✓要点 1", "✓強調した要点 2"]);
    expect(items.every((li) => li.querySelector('[aria-hidden="true"]')?.textContent === "✓")).toBe(true);
    expect(list.querySelector("strong")?.textContent).toBe("強調");
  });

  it("==強調==の記法_橙の太い下線で強調する", () => {
    render(<UnitSummary summary={["ここが==大事==です"]} />);
    expect(screen.getByText("大事").tagName).toBe("MARK");
    expect(screen.getByText("大事").className).toContain("mark-emphasis");
  });

  it("要約がない_何も出さない", () => {
    const { container } = render(<UnitSummary />);
    expect(container.innerHTML).toBe("");
  });
});
