// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_LIMIT_MESSAGE, SEND_LIMIT_NOTE } from "@/lib/auth/messages.ts";
import { SignupForm } from "./signup-form.tsx";

// 規則に合うテスト用の値。実行時に組み立てる
const VALID = ["Example", "Signup", "Phrase-9"].join("-");
const navigate = vi.fn();
vi.mock("@/lib/auth/navigate.ts", () => ({ navigateWithReload: (path: string) => navigate(path) }));

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

async function register(user: ReturnType<typeof userEvent.setup>, password = VALID, confirm = password) {
  await user.type(screen.getByLabelText("メールアドレス"), "new@example.com");
  await user.type(screen.getByLabelText("パスワード"), password);
  await user.type(screen.getByLabelText("パスワード(確認)"), confirm);
  await user.click(screen.getByRole("button", { name: "登録する" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe("SignupForm", () => {
  it("登録の入力_送信の上限の注意書きとプライバシーへのリンクとログインへ戻るリンクを出す", () => {
    render(<SignupForm />);
    expect(screen.getByRole("heading", { level: 1, name: "新規登録" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(SEND_LIMIT_NOTE);
    expect(screen.getByRole("link", { name: "プライバシーと利用条件" }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: "ログインへ戻る" }).getAttribute("href")).toBe("/login");
    // 同意のチェックボックスは置かない
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("登録すると_同じ画面で確認コードの入力に切り替わり_確認するとログインしてホームへ移る", async () => {
    const sent = stubFetch([
      { status: 200, body: { status: "code-sent" } },
      { status: 200, body: { status: "signed-in" } },
    ]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user);
    expect(await screen.findByRole("heading", { level: 1, name: "確認コードの入力" })).toBeTruthy();
    expect(sent[0]).toEqual({ url: "/api/auth/sign-up", body: { email: "new@example.com", password: VALID } });

    await user.type(screen.getByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "確認する" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(sent[1]).toEqual({
      url: "/api/auth/confirm-sign-up",
      body: { email: "new@example.com", code: "123456", password: VALID },
    });
  });

  it("パスワードが規則に合わないか確認と一致しない_送信せずに理由を出す", async () => {
    const sent = stubFetch([]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user, "short");
    expect((await screen.findByRole("alert")).textContent).toContain("12 文字以上");
    await user.clear(screen.getByLabelText("パスワード"));
    await user.clear(screen.getByLabelText("パスワード(確認)"));
    await user.type(screen.getByLabelText("パスワード"), VALID);
    await user.type(screen.getByLabelText("パスワード(確認)"), `${VALID}x`);
    await user.click(screen.getByRole("button", { name: "登録する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("一致しません");
    expect(sent).toHaveLength(0);
  });

  it("登録で送信の上限に当たる_上限の文言を読み上げの対象で出し_登録の入力に留まる", async () => {
    stubFetch([{ status: 429, body: { error: "send-limit" } }]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user);
    expect((await screen.findByRole("alert")).textContent).toContain(SEND_LIMIT_MESSAGE);
    expect(screen.getByRole("button", { name: "登録する" })).toBeTruthy();
  });

  it("登録済みのメールアドレス_登録できない文言を出す", async () => {
    stubFetch([{ status: 409, body: { error: "already-exists" } }]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user);
    expect((await screen.findByRole("alert")).textContent).toContain("このメールアドレスでは登録できません");
  });

  it("コードを送り直す_送り直したと出し_送信の上限に当たると上限の文言を読み上げの対象で出す", async () => {
    const sent = stubFetch([
      { status: 200, body: { status: "code-sent" } },
      { status: 200, body: { status: "sent" } },
      { status: 429, body: { error: "send-limit" } },
    ]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user);
    await user.click(await screen.findByRole("button", { name: "コードを送り直す" }));
    expect((await screen.findByRole("status")).textContent).toContain("送り直しました");
    expect(sent[1]).toEqual({ url: "/api/auth/resend-code", body: { email: "new@example.com" } });

    await user.click(screen.getByRole("button", { name: "コードを送り直す" }));
    expect((await screen.findByRole("alert")).textContent).toContain(SEND_LIMIT_MESSAGE);
  });

  it("確認コードが違う_固定の文言を出し_移動しない", async () => {
    stubFetch([
      { status: 200, body: { status: "code-sent" } },
      { status: 400, body: { error: "code-invalid" } },
    ]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user);
    await user.type(await screen.findByLabelText("確認コード"), "000000");
    await user.click(screen.getByRole("button", { name: "確認する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("確認コードが正しくありません");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("確認は通ったがログインできない_確認したと出し_ログインへのリンクを出す", async () => {
    stubFetch([
      { status: 200, body: { status: "code-sent" } },
      { status: 200, body: { status: "confirmed" } },
    ]);
    const user = userEvent.setup();
    render(<SignupForm />);
    await register(user);
    await user.type(await screen.findByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "確認する" }));
    expect(await screen.findByRole("heading", { level: 1, name: "メールアドレスを確認しました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ログインへ" }).getAttribute("href")).toBe("/login");
    expect(navigate).not.toHaveBeenCalled();
  });
});
