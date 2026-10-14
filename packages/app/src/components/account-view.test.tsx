// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSettings, saveSettings } from "@/lib/storage.ts";
import { AccountView } from "./account-view.tsx";

vi.mock("./session-provider.tsx", () => ({
  useSession: () => ({
    state: { status: "signed-in", email: "learner@example.com", expiresAt: null, isAdmin: false },
    reload: async () => {},
    signOut: async () => {},
  }),
}));

type Init = { method?: string; body?: string };

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: Init) => Promise<unknown>>>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, _init?: Init) => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const prefsPuts = () =>
  fetchMock.mock.calls.filter(([url, init]) => url === "/api/history/prefs" && init?.method === "PUT");

describe("AccountView のシャッフルの設定", () => {
  it("シャッフルを切り替える_端末に保存し_アカウントにも送る", async () => {
    render(<AccountView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "選択肢の並びをシャッフルする" }));

    expect(loadSettings(browserStore()).shuffleChoices).toBe(true);
    await waitFor(() => expect(prefsPuts()).toHaveLength(1));
    expect(JSON.parse(prefsPuts()[0]?.[1]?.body ?? "{}")).toEqual({
      theme: "system",
      style: "rich",
      shuffleChoices: true,
    });
  });

  it("解答の表示のしかた_端末の値を残し_アカウントへは送らない", async () => {
    saveSettings(browserStore(), { shuffleChoices: false, reveal: "each" });
    render(<AccountView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "選択肢の並びをシャッフルする" }));

    expect(loadSettings(browserStore())).toEqual({ shuffleChoices: true, reveal: "each" });
    await waitFor(() => expect(prefsPuts()).toHaveLength(1));
    expect(JSON.parse(prefsPuts()[0]?.[1]?.body ?? "{}")).not.toHaveProperty("reveal");
  });

  it("保存先の注記_端末とアカウントの両方と_解答の表示のしかたは端末だけと示す", async () => {
    render(<AccountView />);
    expect(await screen.findByText(/この端末と、アカウントに保存されます/)).toBeTruthy();
    expect(screen.getByText(/解答の表示のしかたは、この端末にだけ保存されます/)).toBeTruthy();
  });
});
