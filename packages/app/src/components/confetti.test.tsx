// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFETTI_TOTAL_MS } from "@/lib/confetti.ts";
import { Confetti } from "./confetti.tsx";

function mockMotionPreference(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
}

function setStyle(style: "rich" | "simple") {
  document.documentElement.setAttribute("data-style", style);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-style");
});

describe("Confetti", () => {
  it("リッチで_合格ラインに届いた_紙吹雪を出し_読み上げの対象にしない_時間がたつと片付ける", () => {
    mockMotionPreference(false);
    setStyle("rich");
    const { container } = render(<Confetti reached />);
    const layer = container.querySelector("[data-confetti]");
    expect(layer).not.toBeNull();
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.children.length).toBeGreaterThan(0);

    act(() => {
      vi.advanceTimersByTime(CONFETTI_TOTAL_MS);
    });
    expect(container.querySelector("[data-confetti]")).toBeNull();
  });

  it("動きを減らす設定_リッチでも出さない", () => {
    mockMotionPreference(true);
    setStyle("rich");
    const { container } = render(<Confetti reached />);
    expect(container.querySelector("[data-confetti]")).toBeNull();
  });

  it("動きを減らす設定_シンプルでも出さない", () => {
    mockMotionPreference(true);
    setStyle("simple");
    const { container } = render(<Confetti reached />);
    expect(container.querySelector("[data-confetti]")).toBeNull();
  });

  it("シンプル_出さない", () => {
    mockMotionPreference(false);
    setStyle("simple");
    const { container } = render(<Confetti reached />);
    expect(container.querySelector("[data-confetti]")).toBeNull();
  });

  it("合格ラインに届いていない_出さない", () => {
    mockMotionPreference(false);
    setStyle("rich");
    const { container } = render(<Confetti reached={false} />);
    expect(container.querySelector("[data-confetti]")).toBeNull();
  });

  it("表示中にシンプルへ切り替える_紙吹雪を消す", async () => {
    mockMotionPreference(false);
    setStyle("rich");
    const { container } = render(<Confetti reached />);
    expect(container.querySelector("[data-confetti]")).not.toBeNull();

    await act(async () => {
      setStyle("simple");
      // 属性の変化の通知(MutationObserver)を待つ
      await Promise.resolve();
    });
    expect(container.querySelector("[data-confetti]")).toBeNull();
  });
});
