import { describe, expect, it, vi } from "vitest";
import { showFromTop } from "./page-top.ts";

describe("showFromTop", () => {
  it("設問がある_先頭へ戻してから設問へスクロールなしでフォーカスする", () => {
    const calls: string[] = [];
    const view = { scrollTo: vi.fn(() => calls.push("scroll")) };
    const target = { focus: vi.fn(() => calls.push("focus")) };
    showFromTop(target, view);
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
    expect(target.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(calls).toEqual(["scroll", "focus"]);
  });

  it("設問がない_先頭へ戻すだけで止まらない", () => {
    const view = { scrollTo: vi.fn() };
    showFromTop(null, view);
    expect(view.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0 });
  });
});
