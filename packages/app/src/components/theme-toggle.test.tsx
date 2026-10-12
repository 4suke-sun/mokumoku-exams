// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "@/lib/theme.ts";
import { ThemeToggle } from "./theme-toggle.tsx";

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
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

describe("ThemeToggle", () => {
  it("未設定_端末に従うを選んだ状態で表示する", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "端末に従う" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("ダークを選ぶ_画面に反映し_端末に保存し_アカウントにも送る", async () => {
    render(<ThemeToggle />);
    await userEvent.setup().click(screen.getByRole("button", { name: "ダーク" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "ダーク" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/history/prefs");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ theme: "dark", style: "rich", shuffleChoices: false });
  });

  it("サーバーや初回描画の前のスクリプトが反映した属性_その選択で表示する", () => {
    document.documentElement.setAttribute("data-theme", "light");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: "ライト" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("同期で属性が変わった_表示の選択も追従する", async () => {
    render(<ThemeToggle />);
    await act(async () => {
      document.documentElement.setAttribute("data-theme", "dark");
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "ダーク" }).getAttribute("aria-pressed")).toBe("true"),
    );
  });

  it("端末に従うへ戻す_属性を外す", async () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);
    await userEvent.setup().click(screen.getByRole("button", { name: "端末に従う" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
