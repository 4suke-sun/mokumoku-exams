// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STYLE_KEY } from "@/lib/visual-style.ts";
import { StyleToggle } from "./style-toggle.tsx";

const fetchMock = vi.fn(async (_url: string, _init?: { method?: string; body?: string }) => ({
  ok: true,
  status: 200,
  json: async () => ({ status: "saved" }),
}));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  document.documentElement.removeAttribute("data-style");
  vi.unstubAllGlobals();
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

  it("シンプルを選ぶ_アカウントにも送る", async () => {
    render(<StyleToggle />);
    await userEvent.click(screen.getByRole("button", { name: "シンプル" }));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/history/prefs");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ theme: "system", style: "simple", shuffleChoices: false });
  });
});
