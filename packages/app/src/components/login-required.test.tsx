// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ status: "signed-in" as "signed-in" | "signed-out" | "loading" }));
vi.mock("./session-provider.tsx", () => ({
  useSession: () => ({ state: { status: session.status }, reload: async () => {}, signOut: async () => {} }),
}));

const { LoginRequired, loginHref } = await import("./login-required.tsx");

afterEach(() => {
  cleanup();
});

function renderGate() {
  return render(
    <LoginRequired message="投稿はログインユーザーのみ受け付けております。" next="/contact?exam=EX-SMP-XX">
      <button type="button">送る</button>
    </LoginRequired>,
  );
}

describe("LoginRequired", () => {
  it("ログイン中_中身を出し_ログインの案内を出さない", () => {
    session.status = "signed-in";
    renderGate();
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
    expect(screen.queryByText(/ログインユーザーのみ/)).toBeNull();
  });

  it("ログインしていない_中身の代わりに案内を出し_ログインとアカウントの作成のボタンを出す", () => {
    session.status = "signed-out";
    renderGate();
    expect(screen.queryByRole("button", { name: "送る" })).toBeNull();
    expect(screen.getByText("投稿はログインユーザーのみ受け付けております。")).toBeTruthy();
    expect(screen.getByRole("link", { name: "ログインする" }).getAttribute("href")).toBe(
      loginHref("/contact?exam=EX-SMP-XX"),
    );
    expect(screen.getByRole("link", { name: "アカウントを作成する" }).getAttribute("href")).toBe("/signup");
  });

  it("ログイン状態を確かめている間_中身もログインの案内も出さない", () => {
    session.status = "loading";
    const { container } = renderGate();
    expect(container.innerHTML).toBe("");
  });
});

describe("loginHref", () => {
  it("戻る場所に検索条件を含む_next に元の形のまま入れる", () => {
    const href = loginHref("/contact?exam=EX-SMP-XX");
    const url = new URL(href, "https://example.com");
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/contact?exam=EX-SMP-XX");
  });
});
