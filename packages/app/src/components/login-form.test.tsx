// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_LIMIT_MESSAGE } from "@/lib/auth/messages.ts";
import { LoginForm } from "./login-form.tsx";

// 規則に合うテスト用の値。実行時に組み立てる
const FRESH = ["Example", "Fresh", "Phrase-9"].join("-");
const navigate = vi.fn();
vi.mock("@/lib/auth/navigate.ts", () => ({ navigateWithReload: (path: string) => navigate(path) }));

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
  navigate.mockReset();
});

describe("LoginForm", () => {
  it("ログインに成功すると_ページごと読み込み直してホームへ移動する", async () => {
    const fetchMock = mockFetch({ status: 200, body: { status: "signed-in" } });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), ["Example", "Phrase-1"].join("-"));
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/login");
  });

  it("認証に失敗すると_固定の文言を出し_移動しない", async () => {
    mockFetch({ status: 401, body: { error: "invalid-credentials" } });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    expect((await screen.findByRole("alert")).textContent).toContain("正しくありません");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("初回ログインでは_新しいパスワードの入力に切り替わり_決めるとページごと読み込み直してホームへ移動する", async () => {
    const fetchMock = mockFetch(
      { status: 200, body: { status: "new-password-required", session: "s", username: "u" } },
      { status: 200, body: { status: "signed-in" } },
    );
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), ["Example", "Temp-1"].join("-"));
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));

    await userEvent.type(await screen.findByLabelText("新しいパスワード"), FRESH);
    await userEvent.type(screen.getByLabelText("新しいパスワード(確認)"), FRESH);
    await userEvent.click(screen.getByRole("button", { name: "パスワードを決めてログインする" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
      username: "u",
      session: "s",
      newPassword: FRESH,
    });
  });

  it("移動の先が指定されていれば_ログインのあとにその画面へ移る", async () => {
    mockFetch(
      { status: 200, body: { status: "new-password-required", session: "s", username: "u" } },
      { status: 200, body: { status: "signed-in" } },
    );
    render(<LoginForm next="/exams" />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), ["Example", "Temp-1"].join("-"));
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    await userEvent.type(await screen.findByLabelText("新しいパスワード"), FRESH);
    await userEvent.type(screen.getByLabelText("新しいパスワード(確認)"), FRESH);
    await userEvent.click(screen.getByRole("button", { name: "パスワードを決めてログインする" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/exams"));
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

  it("ログインの入力_メールアドレスとパスワードで入る案内と新規登録とパスワードの再設定のリンクを出す", () => {
    render(<LoginForm />);
    expect(screen.getByText("メールアドレスとパスワードで、ログインしてください。")).toBeTruthy();
    expect(screen.queryByText(/招待/)).toBeNull();
    expect(screen.getByRole("link", { name: "新規登録" }).getAttribute("href")).toBe("/signup");
    expect(screen.getByRole("link", { name: "パスワードを忘れたとき" }).getAttribute("href")).toBe("/forgot-password");
  });

  it("退会のあとに移ってきた_退会しましたと出す", () => {
    render(<LoginForm deleted />);
    expect(screen.getByRole("status").textContent).toContain("退会しました");
  });

  it("確認がまだの利用者_確認コードの入力に移り_確認すると入れたパスワードでログインして移動する", async () => {
    const password = ["Example", "Phrase-1"].join("-");
    const fetchMock = mockFetch(
      { status: 403, body: { error: "not-confirmed" } },
      { status: 429, body: { error: "send-limit" } },
      { status: 200, body: { status: "signed-in" } },
    );
    render(<LoginForm next="/exams" />);
    await userEvent.type(screen.getByLabelText("メールアドレス"), "user@example.com");
    await userEvent.type(screen.getByLabelText("パスワード"), password);
    await userEvent.click(screen.getByRole("button", { name: "ログインする" }));
    expect(await screen.findByRole("heading", { level: 1, name: "確認コードの入力" })).toBeTruthy();
    // 送り直しで送信の上限に当たったときも、上限の文言を出す
    await userEvent.click(screen.getByRole("button", { name: "コードを送り直す" }));
    expect((await screen.findByRole("alert")).textContent).toContain(SEND_LIMIT_MESSAGE);
    await userEvent.type(screen.getByLabelText("確認コード"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "確認する" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/exams"));
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/auth/confirm-sign-up");
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1].body)).toEqual({
      email: "user@example.com",
      code: "123456",
      password,
    });
  });
});
