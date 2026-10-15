// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "./forgot-password-form.tsx";

const VALID = "Valid-Password-123";

type Reply = { status: number; body: unknown };

/** 送った先と本文を記録し、順に返事をする fetch */
function stubFetch(replies: Reply[]) {
  const sent: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body ?? "null")) });
      const reply = replies.shift() ?? { status: 503, body: { error: "unavailable" } };
      return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
    }),
  );
  return sent;
}

async function requestCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("メールアドレス"), "user@example.com");
  await user.click(screen.getByRole("button", { name: "確認コードを送る" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ForgotPasswordForm", () => {
  it("確認コードを送ってから新しいパスワードを送る_3 段階で完了を示す", async () => {
    const sent = stubFetch([
      { status: 200, body: { status: "sent" } },
      { status: 200, body: { status: "reset" } },
    ]);
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();
    await requestCode(user);
    expect(await screen.findByRole("heading", { name: "新しいパスワードを決める" })).toBeTruthy();

    await user.type(screen.getByLabelText("確認コード"), "123456");
    await user.type(screen.getByLabelText("新しいパスワード"), VALID);
    await user.type(screen.getByLabelText("新しいパスワード(確認)"), VALID);
    await user.click(screen.getByRole("button", { name: "パスワードを変更する" }));

    expect(await screen.findByRole("heading", { name: "パスワードを変更しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ログインへ" }).getAttribute("href")).toBe("/login");
    expect(sent).toEqual([
      { url: "/api/auth/forgot-password", body: { email: "user@example.com" } },
      { url: "/api/auth/reset-password", body: { email: "user@example.com", code: "123456", newPassword: VALID } },
    ]);
  });

  it("確認コードを送れない_最初の段階にとどまり_失敗を示す", async () => {
    stubFetch([{ status: 429, body: { error: "limit-exceeded" } }]);
    render(<ForgotPasswordForm />);
    await requestCode(userEvent.setup());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "パスワードの再設定" })).toBeTruthy();
  });

  it("新しいパスワードが規則に合わないか確認と違う_送らずに理由を示す", async () => {
    const sent = stubFetch([{ status: 200, body: { status: "sent" } }]);
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();
    await requestCode(user);
    await screen.findByRole("heading", { name: "新しいパスワードを決める" });

    await user.type(screen.getByLabelText("確認コード"), "123456");
    await user.type(screen.getByLabelText("新しいパスワード"), "short");
    await user.type(screen.getByLabelText("新しいパスワード(確認)"), "short");
    await user.click(screen.getByRole("button", { name: "パスワードを変更する" }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    await user.clear(screen.getByLabelText("新しいパスワード"));
    await user.type(screen.getByLabelText("新しいパスワード"), VALID);
    await user.click(screen.getByRole("button", { name: "パスワードを変更する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("確認用のパスワードが一致しません。");
    expect(sent).toHaveLength(1);
  });

  it("確認コードが違う_新しいパスワードの段階にとどまり_失敗を示す", async () => {
    stubFetch([
      { status: 200, body: { status: "sent" } },
      { status: 400, body: { error: "code-invalid" } },
    ]);
    render(<ForgotPasswordForm />);
    const user = userEvent.setup();
    await requestCode(user);
    await screen.findByRole("heading", { name: "新しいパスワードを決める" });
    await user.type(screen.getByLabelText("確認コード"), "000000");
    await user.type(screen.getByLabelText("新しいパスワード"), VALID);
    await user.type(screen.getByLabelText("新しいパスワード(確認)"), VALID);
    await user.click(screen.getByRole("button", { name: "パスワードを変更する" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "新しいパスワードを決める" })).toBeTruthy();
  });
});
