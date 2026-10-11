// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STYLE_KEY } from "@/lib/visual-style.ts";
import { StyleToggle } from "./style-toggle.tsx";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-style");
});

describe("StyleToggle", () => {
  it("未設定_リッチを選んだ状態で表示する", () => {
    render(<StyleToggle />);
    expect(screen.getByRole("button", { name: "リッチ" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "シンプル" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("シンプルを選ぶ_画面に反映し_端末に保存する", async () => {
    render(<StyleToggle />);
    await userEvent.click(screen.getByRole("button", { name: "シンプル" }));
    expect(document.documentElement.getAttribute("data-style")).toBe("simple");
    expect(localStorage.getItem(STYLE_KEY)).toBe("simple");
    expect(screen.getByRole("button", { name: "シンプル" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("保存済みの選択(初回描画の前のスクリプトが反映した属性)_その選択で表示する", () => {
    document.documentElement.setAttribute("data-style", "simple");
    render(<StyleToggle />);
    expect(screen.getByRole("button", { name: "シンプル" }).getAttribute("aria-pressed")).toBe("true");
  });
});
