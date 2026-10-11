// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BADGE_DELAY_MS, BADGE_VISIBLE_MS, LoadingBadge } from "./loading-badge.tsx";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LoadingBadge", () => {
  it("読み上げの領域は_待ちがなくても置いておく", () => {
    render(<LoadingBadge active={false} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("短い待ち_バッジを出さない", () => {
    const { rerender } = render(<LoadingBadge active />);
    act(() => {
      vi.advanceTimersByTime(BADGE_DELAY_MS - 1);
    });
    rerender(<LoadingBadge active={false} />);
    act(() => {
      vi.advanceTimersByTime(BADGE_DELAY_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("長い待ち_バッジを出して読み上げ_一定時間で消す", () => {
    render(<LoadingBadge active />);
    act(() => {
      vi.advanceTimersByTime(BADGE_DELAY_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("読み込み中…");

    act(() => {
      vi.advanceTimersByTime(BADGE_VISIBLE_MS);
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("待ちが終わる_すぐに消す", () => {
    const { rerender } = render(<LoadingBadge active />);
    act(() => {
      vi.advanceTimersByTime(BADGE_DELAY_MS);
    });
    rerender(<LoadingBadge active={false} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
