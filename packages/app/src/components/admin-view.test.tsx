// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createdLabel, statusLabel } from "@/lib/admin/client.ts";
import { AdminView } from "./admin-view.tsx";

const row = (username: string, email: string, extra: Record<string, unknown> = {}) => ({
  username,
  email,
  status: "CONFIRMED",
  enabled: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  self: false,
  ...extra,
});

function mockFetch(...responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({ ok: r.status < 400, status: r.status, json: async () => r.body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminView", () => {
  it("一覧_メールアドレス・状態・作成日を出し_自分と無効な利用者には無効化の操作を出さない", async () => {
    mockFetch({
      status: 200,
      body: {
        users: [
          row("u-self", "admin@example.com", { self: true }),
          row("u-off", "off@example.com", { enabled: false }),
          row("u-new", "new@example.com", { status: "FORCE_CHANGE_PASSWORD" }),
        ],
      },
    });
    render(<AdminView />);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("admin@example.com");
    expect(items[0]?.textContent).toContain("(自分)");
    expect(items[1]?.textContent).toContain("無効");
    expect(items[2]?.textContent).toContain("招待中");
    expect(items[2]?.textContent).toContain("2026-10-01");
    expect(within(items[0] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(items[1] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(items[2] as HTMLElement).getByRole("button", { name: "無効にする…" })).toBeTruthy();
  });

  it("無効化_確認のステップのあとにだけ送る_やめると送らない", async () => {
    const fetchMock = mockFetch(
      { status: 200, body: { users: [row("u-1", "one@example.com")] } },
      { status: 200, body: { status: "disabled" } },
      { status: 200, body: { users: [row("u-1", "one@example.com", { enabled: false })] } },
    );
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "無効にする…" }));
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "無効にする…" }));
    expect(screen.getByText(/無効にしますか/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "無効にする" }));
    expect((await screen.findByRole("status")).textContent).toContain("one@example.com を無効にしました");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/users/disable");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ username: "u-1" });
    await waitFor(() => expect(screen.getByRole("listitem").textContent).toContain("無効"));
  });

  it("招待_結果を出し_一覧を読み直す_失敗は固定の文言を出す", async () => {
    const fetchMock = mockFetch(
      { status: 200, body: { users: [] } },
      { status: 200, body: { user: row("u-2", "two@example.com", { status: "FORCE_CHANGE_PASSWORD" }) } },
      { status: 200, body: { users: [row("u-2", "two@example.com", { status: "FORCE_CHANGE_PASSWORD" })] } },
      { status: 409, body: { error: "already-exists" } },
    );
    render(<AdminView />);
    expect(await screen.findByText("ユーザーはいません。")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("メールアドレス"), "two@example.com");
    await userEvent.click(screen.getByRole("button", { name: "招待する" }));
    expect((await screen.findByRole("status")).textContent).toContain("two@example.com を招待しました");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/users");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ email: "two@example.com" });
    expect(await screen.findByRole("listitem")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("メールアドレス"), "two@example.com");
    await userEvent.click(screen.getByRole("button", { name: "招待する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("すでに登録されています");
  });
});

describe("管理者への昇格", () => {
  const users = [
    row("u-self", "admin@example.com", { self: true }),
    row("u-off", "off@example.com", { enabled: false }),
    row("u-1", "one@example.com"),
  ];

  it("自分と無効な利用者_昇格の操作を出さない", async () => {
    mockFetch({ status: 200, body: { users } });
    render(<AdminView />);
    const items = await screen.findAllByRole("listitem");
    expect(within(items[0] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(items[1] as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(items[2] as HTMLElement).getByRole("button", { name: "one@example.comを管理者にする" })).toBeTruthy();
  });

  it("押す_確認のダイアログが開き_安全側のやめるにフォーカスが移り_まだ送らない", async () => {
    const fetchMock = mockFetch({ status: 200, body: { users } });
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "one@example.comを管理者にする" }));
    const dialog = screen.getByRole("alertdialog", { name: "管理者にしますか" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(within(dialog).getByText(/one@example.com/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "やめる" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("やめる・Esc_閉じて送らず_開いたボタンへフォーカスを戻す", async () => {
    const fetchMock = mockFetch({ status: 200, body: { users } });
    render(<AdminView />);
    const trigger = await screen.findByRole("button", { name: "one@example.comを管理者にする" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Tab_ダイアログの中で巡回し_外へ出ない", async () => {
    mockFetch({ status: 200, body: { users } });
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "one@example.comを管理者にする" }));
    const cancel = screen.getByRole("button", { name: "やめる" });
    const confirm = screen.getByRole("button", { name: "管理者にする" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab();
    expect(document.activeElement).toBe(confirm);
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("管理者にする_ユーザー名だけを送り_結果を伝え_一覧を読み直す", async () => {
    const fetchMock = mockFetch(
      { status: 200, body: { users } },
      { status: 200, body: { status: "promoted" } },
      { status: 200, body: { users } },
    );
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "one@example.comを管理者にする" }));
    await userEvent.click(screen.getByRole("button", { name: "管理者にする" }));
    expect((await screen.findByRole("status")).textContent).toContain("one@example.com を管理者にしました");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/admin/users/promote");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ username: "u-1" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("失敗_固定の文言を出し_ダイアログを閉じる", async () => {
    mockFetch(
      { status: 200, body: { users } },
      { status: 403, body: { error: "forbidden" } },
      { status: 200, body: { users } },
    );
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "one@example.comを管理者にする" }));
    await userEvent.click(screen.getByRole("button", { name: "管理者にする" }));
    expect((await screen.findByRole("alert")).textContent).toContain("管理者だけができます");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("無効化の操作_昇格の操作を足しても変わらず動く", async () => {
    mockFetch({ status: 200, body: { users: [row("u-1", "one@example.com")] } });
    render(<AdminView />);
    await userEvent.click(await screen.findByRole("button", { name: "無効にする…" }));
    expect(screen.getByText(/無効にしますか/)).toBeTruthy();
  });
});

describe("表示の文言", () => {
  it("状態_無効を優先し_既知の状態は日本語にする", () => {
    expect(statusLabel({ enabled: false, status: "CONFIRMED" })).toBe("無効");
    expect(statusLabel({ enabled: true, status: "CONFIRMED" })).toBe("有効");
    expect(statusLabel({ enabled: true, status: "FORCE_CHANGE_PASSWORD" })).toBe("招待中(初回ログイン前)");
    expect(statusLabel({ enabled: true, status: "UNKNOWN" })).toBe("その他");
  });

  it("作成日_日付だけを出し_ないときは「-」", () => {
    expect(createdLabel("2026-10-01T12:34:56.000Z")).toBe("2026-10-01");
    expect(createdLabel(null)).toBe("-");
  });
});
