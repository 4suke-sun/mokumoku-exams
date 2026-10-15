// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PushSettings } from "./push-settings.tsx";

const client = vi.hoisted(() => ({
  pushSupported: vi.fn(() => true),
  currentSubscription: vi.fn(async () => null as object | null),
  subscribePush: vi.fn(async () => "subscribed" as "subscribed" | "denied" | "failed"),
  unsubscribePush: vi.fn(async () => true),
  sendTestNotification: vi.fn(async () => 1 as number | null),
}));
vi.mock("@/lib/push/client.ts", () => client);

const KEY = "public-key-example";

beforeEach(() => {
  vi.clearAllMocks();
  client.pushSupported.mockReturnValue(true);
  client.currentSubscription.mockResolvedValue(null);
});

describe("通知の設定", () => {
  it("鍵が設定されていない_設定できない旨を出し_操作を出さない", async () => {
    render(<PushSettings publicKey={null} />);
    expect(await screen.findByText("この環境では、通知を設定できません。")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("通知に対応していないブラウザ_その旨を出す", async () => {
    client.pushSupported.mockReturnValue(false);
    render(<PushSettings publicKey={KEY} />);
    expect(await screen.findByText("このブラウザは、通知に対応していません。")).toBeTruthy();
  });

  it("購読していない_受け取る操作で購読し_状態が切り替わる", async () => {
    render(<PushSettings publicKey={KEY} />);
    await userEvent.click(await screen.findByRole("button", { name: "通知を受け取る" }));
    expect(client.subscribePush).toHaveBeenCalledWith(KEY);
    expect(await screen.findByText("この端末で、通知を受け取っています。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "通知を止める" })).toBeTruthy();
  });

  it("通知が許可されない_購読していないままで_許可の方法を案内する", async () => {
    client.subscribePush.mockResolvedValueOnce("denied");
    render(<PushSettings publicKey={KEY} />);
    await userEvent.click(await screen.findByRole("button", { name: "通知を受け取る" }));
    expect((await screen.findByRole("alert")).textContent).toContain("許可");
    expect(screen.getByText("この端末では、通知を受け取っていません。")).toBeTruthy();
  });

  it("管理者でない_購読していてもテスト通知のボタンを出さない", async () => {
    client.currentSubscription.mockResolvedValue({});
    render(<PushSettings publicKey={KEY} />);
    expect(await screen.findByRole("button", { name: "通知を止める" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "テスト通知を送る" })).toBeNull();
  });

  it("管理者が購読している_テスト通知を送れ_止めると状態が切り替わる", async () => {
    client.currentSubscription.mockResolvedValue({});
    render(<PushSettings publicKey={KEY} canSendTest />);
    await userEvent.click(await screen.findByRole("button", { name: "テスト通知を送る" }));
    expect((await screen.findByRole("status")).textContent).toContain("テスト通知を送りました。");
    await userEvent.click(screen.getByRole("button", { name: "通知を止める" }));
    expect(await screen.findByText("この端末では、通知を受け取っていません。")).toBeTruthy();
  });
});
