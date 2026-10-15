// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSettings, saveSettings } from "@/lib/storage.ts";
import { AccountView } from "./account-view.tsx";

const SIGNED_IN = { status: "signed-in", email: "learner@example.com", expiresAt: null, isAdmin: false };
const session = vi.hoisted(() => ({ state: {} as Record<string, unknown>, reload: vi.fn(async () => {}) }));

vi.mock("./session-provider.tsx", () => ({
  useSession: () => ({ state: session.state, reload: session.reload, signOut: async () => {} }),
}));

type Init = { method?: string; body?: string };

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: Init) => Promise<unknown>>>;

beforeEach(() => {
  session.state = SIGNED_IN;
  session.reload.mockClear();
  fetchMock = vi.fn(async (_url: string, _init?: Init) => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
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

describe("AccountView のパスワードの変更", () => {
  const VALID = "Valid-Password-123";
  const OLD = "Old-Password-123";

  async function fill(user: ReturnType<typeof userEvent.setup>, proposed: string, confirm: string) {
    await user.type(screen.getByLabelText("いまのパスワード"), OLD);
    await user.type(screen.getByLabelText("新しいパスワード"), proposed);
    await user.type(screen.getByLabelText("新しいパスワード(確認)"), confirm);
    await user.click(screen.getByRole("button", { name: "パスワードを変更する" }));
  }
  const changeCalls = () => fetchMock.mock.calls.filter(([url]) => url === "/api/auth/change-password");

  it("規則に合わないか確認と違う_送らずに理由を示す", async () => {
    render(<AccountView />);
    const user = userEvent.setup();
    await fill(user, "short", "short");
    expect(await screen.findByRole("alert")).toBeTruthy();
    await user.clear(screen.getByLabelText("新しいパスワード"));
    await user.type(screen.getByLabelText("新しいパスワード"), VALID);
    await user.click(screen.getByRole("button", { name: "パスワードを変更する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("確認用のパスワードが一致しません。");
    expect(changeCalls()).toHaveLength(0);
  });

  it("変更できた_いまと新しいパスワードを送り_完了を示して入力を空にする", async () => {
    render(<AccountView />);
    const user = userEvent.setup();
    await fill(user, VALID, VALID);
    expect((await screen.findByRole("status")).textContent).toContain("パスワードを変更しました。");
    expect(JSON.parse(changeCalls()[0]?.[1]?.body ?? "{}")).toEqual({
      previousPassword: OLD,
      proposedPassword: VALID,
    });
    expect((screen.getByLabelText("新しいパスワード") as HTMLInputElement).value).toBe("");
  });

  it("サーバーが失敗した_失敗を示し_ログインの状態は読み直さない", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid-credentials" }),
    }));
    render(<AccountView />);
    await fill(userEvent.setup(), VALID, VALID);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(session.reload).not.toHaveBeenCalled();
  });

  it("ログインの期限が切れていた_失敗を示し_ログインの状態を読み直す", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "session-expired" }),
    }));
    render(<AccountView />);
    await fill(userEvent.setup(), VALID, VALID);
    await waitFor(() => expect(session.reload).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

describe("AccountView のログインしていないとき", () => {
  it("ログインしていない_ログインへの案内だけを出す", () => {
    session.state = { status: "signed-out" };
    render(<AccountView />);
    expect(screen.getByText("アカウントを見るには、ログインしてください。")).toBeTruthy();
    expect(screen.getByRole("link", { name: "ログインへ" }).getAttribute("href")).toBe("/login");
    expect(screen.queryByRole("button", { name: "パスワードを変更する" })).toBeNull();
  });
});
