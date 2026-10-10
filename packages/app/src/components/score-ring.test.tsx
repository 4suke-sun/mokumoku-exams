// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScoreRing } from "./score-ring.tsx";

function mockMotionPreference(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ScoreRing", () => {
  it("読み上げ用には_最終の値だけを伝える", () => {
    mockMotionPreference(false);
    render(<ScoreRing percent={72} reached />);
    expect(screen.getByRole("img", { name: "正答率 72%" })).toBeTruthy();
  });

  it("動きを減らす設定_最初から最終の値を表示する", () => {
    mockMotionPreference(true);
    const { container } = render(<ScoreRing percent={72} reached />);
    expect(container.textContent).toBe("72%");
  });

  it("通常_0 から増えて_最終の値で止まる", () => {
    mockMotionPreference(false);
    const { container } = render(<ScoreRing percent={80} reached={false} />);
    expect(container.textContent).toBe("0%");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    const midway = Number.parseFloat(container.textContent ?? "");
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(80);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.textContent).toBe("80%");
  });
});
