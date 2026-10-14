// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserStore, saveSession, setStorageOwner, storageOwner } from "@/lib/storage.ts";
import { AuthStatus } from "./auth-status.tsx";
import { SessionProvider } from "./session-provider.tsx";

const push = vi.fn();
// 本物のルーターと同じく、描画のたびに同じオブジェクトを返す
const router = { push, refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// 更新の時刻は「期限の 5 分前」。期限を 5 分の少し先にして、短い待ちで更新を起こす
const exp = () => Date.now() / 1000 + 300.05;
const far = () => Date.now() / 1000 + 3600;

function reply(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

const calledPaths = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map((c) => c[0]);

describe("SessionProvider", () => {
  it("ログイン中は_アカウントとログアウトを出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply(200, { signedIn: true, email: "u@example.com", expiresAt: far() })),
    );
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    expect(await screen.findByRole("link", { name: "アカウント" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeTruthy();
  });

  it("ログインしていないとき_ログインへの案内を出す", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200, { signedIn: false })));
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    expect(await screen.findByRole("link", { name: "ログイン" })).toBeTruthy();
  });

  it("期限の 5 分前になると_トークンを更新する", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { signedIn: true, email: null, expiresAt: exp() }))
      .mockResolvedValue(reply(200, { status: "refreshed", signedIn: true, email: null, expiresAt: far() }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(calledPaths(fetchMock)).toContain("/api/auth/refresh"));
  });

  it("更新できなかったとき_ログイン画面へ戻る", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { signedIn: true, email: null, expiresAt: exp() }))
      .mockResolvedValue(reply(401, { error: "session-expired" }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("通信が失敗したとき_ログイン画面へは戻さない", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { signedIn: true, email: null, expiresAt: exp() }))
      .mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(calledPaths(fetchMock)).toContain("/api/auth/refresh"));
    expect(push).not.toHaveBeenCalled();
  });

  it("ログアウトすると_ログアウトの API を呼び_ログイン画面へ移る", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { signedIn: true, email: null, expiresAt: far() }))
      .mockResolvedValue(reply(200, { status: "signed-out" }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(calledPaths(fetchMock)).toContain("/api/auth/logout");
    expect(screen.getByRole("link", { name: "ログイン" })).toBeTruthy();
  });
});

describe("SessionProvider の表示の設定の同期", () => {
  const prefs = { theme: "dark", style: "simple", shuffleChoices: true };

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-style");
  });

  it("ログインした_アカウントの設定を取得し_端末に反映する(1 回だけ)", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/history/prefs"
        ? reply(200, { prefs })
        : reply(200, { signedIn: true, email: "u@example.com", expiresAt: far() }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(document.documentElement.getAttribute("data-style")).toBe("simple"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(calledPaths(fetchMock as never).filter((p) => p === "/api/history/prefs")).toHaveLength(1);
  });

  it("ログインしていない_設定を取得しない", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, { signedIn: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await screen.findByRole("link", { name: "ログイン" });
    expect(calledPaths(fetchMock)).not.toContain("/api/history/prefs");
  });
});

describe("SessionProvider と端末の記録の持ち主", () => {
  const owner = "aaaaaaaaaaaaaaaa";

  it("ログイン中_セッションの応答の印を_端末の記録の持ち主にする", async () => {
    setStorageOwner(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply(200, { signedIn: true, email: null, expiresAt: far(), owner })),
    );
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(storageOwner()).toBe(owner));
  });

  it("セッションに接続できない_印が取れないもの(null)とし_端末の記録を読まない", async () => {
    setStorageOwner(undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await waitFor(() => expect(storageOwner()).toBeNull());
  });

  it("ログアウト_印を外し_端末の記録は消さない", async () => {
    setStorageOwner(owner);
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: {},
      index: 0,
      startedAt: "2026-10-01T00:00:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply(200, { signedIn: true, email: null, expiresAt: far(), owner })),
    );
    render(
      <SessionProvider>
        <AuthStatus />
      </SessionProvider>,
    );
    await userEvent.setup().click(await screen.findByRole("button", { name: "ログアウト" }));
    await waitFor(() => expect(storageOwner()).toBeNull());
    expect(localStorage.getItem(`mokumoku:v1:${owner}:session:TEST`)).not.toBeNull();
    localStorage.clear();
  });
});
