// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScoreRing } from "./score-ring.tsx";

function mockMotionPreference(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
}

/** 円のゲージの中の数値(リッチで見える側) */
function ringText(container: HTMLElement): string {
  return container.querySelector("[data-ring]")?.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-style");
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
    expect(ringText(container)).toBe("72%");
  });

  it("通常_0 から増えて_最終の値で止まる", () => {
    mockMotionPreference(false);
    const { container } = render(<ScoreRing percent={80} reached={false} />);
    expect(ringText(container)).toBe("0%");

    act(() => {
      vi.advanceTimersByTime(400);
    });
    const midway = Number.parseFloat(ringText(container));
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(80);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(ringText(container)).toBe("80%");
  });

  it("シンプル_円はリッチ専用にし_最初から最終の値を表示する", () => {
    mockMotionPreference(false);
    document.documentElement.setAttribute("data-style", "simple");
    const { container } = render(<ScoreRing percent={80} reached />);
    // 円を出さないことは CSS(.rich-only)が受け持つ。数値はカウントアップしない
    expect(container.querySelector(".simple-only")?.textContent).toBe("80%");
    expect(container.querySelector("svg")?.closest(".rich-only")).not.toBeNull();
    expect(ringText(container)).toBe("80%");
    expect(screen.getByRole("img", { name: "正答率 80%" })).toBeTruthy();
  });
});
