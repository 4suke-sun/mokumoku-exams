// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RELEASE_SEEN_KEY } from "@/lib/release-seen.ts";
import { SessionProvider } from "./session-provider.tsx";
import { SiteNav } from "./site-nav.tsx";

const router = { push: vi.fn(), refresh: vi.fn() };
let pathname = "/";
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => pathname }));

const far = () => Date.now() / 1000 + 3600;

function signedIn(isAdmin: boolean | undefined) {
  const body = { signedIn: true, email: "u@example.com", expiresAt: far(), isAdmin };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body }));
}

function renderNav() {
  return render(
    <SessionProvider>
      <SiteNav />
    </SessionProvider>,
  );
}

function openSheet() {
  fireEvent.click(screen.getByRole("button", { name: /メニュー/ }));
  return screen.getByRole("dialog", { name: "メニュー" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  pathname = "/";
  localStorage.clear();
});

describe("SiteNav の管理の項目", () => {
  it("管理者_サイドバーとシートに管理を出す", async () => {
    signedIn(true);
    renderNav();
    expect((await screen.findByRole("link", { name: "管理" })).getAttribute("href")).toBe("/admin");
    expect(within(openSheet()).getByRole("link", { name: "管理" })).toBeTruthy();
  });

  it.each([false, undefined])("管理者でない(%s)_管理を出さない", async (isAdmin) => {
    signedIn(isAdmin);
    renderNav();
    expect((await screen.findAllByRole("link", { name: "アカウント" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "管理" })).toBeNull();
    expect(within(openSheet()).queryByRole("link", { name: "管理" })).toBeNull();
  });
});

describe("メニューのシート", () => {
  it("開くと_閉じるボタンにフォーカスし_Esc で閉じて_開いたボタンに戻す", async () => {
    signedIn(false);
    renderNav();
    const sheet = openSheet();
    expect(document.activeElement).toBe(within(sheet).getByRole("button", { name: "閉じる" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /メニュー/ }));
  });

  it("背景のタップで閉じる", () => {
    signedIn(false);
    renderNav();
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "メニューを閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("閉じるボタンで閉じる", () => {
    signedIn(false);
    renderNav();
    const sheet = openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Tab の移動_シートの中で巡回する", () => {
    signedIn(false);
    renderNav();
    const sheet = openSheet();
    const close = within(sheet).getByRole("button", { name: "閉じる" });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);
  });
});

describe("ドックと上のバー", () => {
  it("出題中_ドックを隠す", () => {
    signedIn(false);
    pathname = "/exams/SAMPLE/play";
    renderNav();
    expect(screen.queryByRole("button", { name: /メニュー/ })).toBeNull();
  });

  it("資格の中の画面_資格の一覧へ戻るボタンを出す", () => {
    signedIn(false);
    pathname = "/exams/SAMPLE";
    renderNav();
    expect(screen.getByRole("link", { name: "資格の一覧へ" }).getAttribute("href")).toBe("/exams");
  });

  it("現在地の項目_aria-current を付ける", () => {
    signedIn(false);
    pathname = "/bookmarks";
    renderNav();
    const current = screen.getAllByRole("link", { name: "ブックマーク" });
    expect(current.every((link) => link.getAttribute("aria-current") === "page")).toBe(true);
  });
});

describe("リリースノートの未読の目印", () => {
  it("まだ見ていない_目印を出し_見た版を保存すると消える", async () => {
    signedIn(false);
    renderNav();
    expect((await screen.findAllByText("(新しい更新があります)")).length).toBeGreaterThan(0);
    await act(async () => {
      const { MarkReleasesSeen } = await import("./release-seen.tsx");
      render(<MarkReleasesSeen />);
    });
    expect(localStorage.getItem(RELEASE_SEEN_KEY)).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(screen.queryByText("(新しい更新があります)")).toBeNull();
  });
});
