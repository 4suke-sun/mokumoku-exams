// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnitSummary } from "./unit-summary.tsx";

describe("UnitSummary", () => {
  it("要約がある_見出しと箇条書きで_この順に出す", () => {
    render(<UnitSummary summary={["要点 1", "**強調**した要点 2"]} />);
    const list = screen.getByRole("region", { name: "この単元の要点" });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["要点 1", "強調した要点 2"]);
    expect(list.querySelector("strong")?.textContent).toBe("強調");
  });

  it("要約がない_何も出さない", () => {
    const { container } = render(<UnitSummary />);
    expect(container.innerHTML).toBe("");
  });
});
