// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./login-form.tsx";

// 規則に合うテスト用の値。実行時に組み立てる
const FRESH = ["Example", "Fresh", "Phrase-9"].join("-");
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({ ok: r.status < 400, status: r.status, json: async () => r.body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
});

describe("LoginForm", () => {
  it("ログインに成功すると_ホームへ移動する", async () => {
    const fetchMock = mockFetch(
      { status: 200, body: { status: "signed-in" } },
      { status: 200, body: { signedIn: false } },
    );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), ["Example", "Phrase-1"].join("-"));
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/login");
  });

  it("認証に失敗すると_固定の文言を出し_移動しない", async () => {
    mockFetch({ status: 401, body: { error: "invalid-credentials" } });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    expect((await screen.findByRole("alert")).textContent).toContain("正しくありません");
    expect(push).not.toHaveBeenCalled();
  });

  it("初回ログインでは_新しいパスワードの入力に切り替わり_決めるとログインできる", async () => {
    const fetchMock = mockFetch(
      { status: 200, body: { status: "new-password-required", session: "s", username: "u" } },
      { status: 200, body: { status: "signed-in" } },
      { status: 200, body: { signedIn: false } },
    );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), ["Example", "Temp-1"].join("-"));
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));

    await userEvent.type(await screen.findByLabelText("新しいパスワード"), FRESH);
    await userEvent.type(screen.getByLabelText("新しいパスワード(確認)"), FRESH);
    await userEvent.click(screen.getByRole("button", { name: "パスワードを決めてログインする" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
      username: "u",
      session: "s",
      newPassword: FRESH,
    });
  });

  it("新しいパスワードが規則に合わないとき_送信せずに理由を出す", async () => {
    const fetchMock = mockFetch({
      status: 200,
      body: { status: "new-password-required", session: "s", username: "u" },
    });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), ["Example", "Temp-1"].join("-"));
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    await userEvent.type(await screen.findByLabelText("新しいパスワード"), "short");
    await userEvent.type(screen.getByLabelText("新しいパスワード(確認)"), "short");
    await userEvent.click(screen.getByRole("button", { name: "パスワードを決めてログインする" }));
    expect((await screen.findByRole("alert")).textContent).toContain("12 文字以上");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
