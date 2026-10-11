// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton, Spinner } from "./skeleton.tsx";

describe("Spinner", () => {
  it("読み込み中であることを_文言で読み上げる_リングは読み上げない", () => {
    const { container } = render(<Spinner />);
    expect(screen.getByRole("status").textContent).toBe("読み込んでいます");
    expect(container.querySelector(".spinner")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("文言を隠す_画面には出さず_読み上げは残す", () => {
    render(<Spinner label="保存しています" hideLabel />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("保存しています");
    expect(status.querySelector(".sr-only")?.textContent).toBe("保存しています");
  });
});

describe("Skeleton", () => {
  it("形だけなので読み上げない", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
