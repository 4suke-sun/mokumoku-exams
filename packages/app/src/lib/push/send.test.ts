import { afterEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "web-push";
import { DAILY_MESSAGE, type PushTarget, sendToAll, webPushSender } from "./send.ts";
import { VapidKeyUnavailableError } from "./vapid.ts";

// web-push は ES モジュールで、名前付きのエクスポートを spyOn で差し替えられないため、モジュールごと差し替える
vi.mock("web-push", () => ({ sendNotification: vi.fn() }));

const target = (n: number): PushTarget => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
  p256dh: "p",
  auth: "a",
});

describe("sendToAll", () => {
  it("すべての送り先に同じ中身を送り_結果の種類ごとに数える", async () => {
    const payloads: string[] = [];
    const targets = Array.from({ length: 23 }, (_, i) => target(i));
    const summary = await sendToAll(targets, DAILY_MESSAGE, async (t, payload) => {
      payloads.push(payload);
      if (t === targets[3]) return "gone";
      if (t === targets[20]) return "failed";
      return "sent";
    });
    expect(summary.sent).toBe(21);
    expect(summary.failed).toBe(1);
    expect(summary.gone).toEqual([targets[3]]);
    expect(new Set(payloads)).toEqual(new Set([JSON.stringify(DAILY_MESSAGE)]));
  });

  it("送り先がない_何も送らない", async () => {
    expect(await sendToAll([], DAILY_MESSAGE, async () => "sent")).toEqual({ sent: 0, failed: 0, gone: [] });
  });
});

describe("webPushSender", () => {
  const vapid = {
    publicKey: "P".repeat(87),
    privateKeyParameter: "/example/push/vapid-private-key",
    subject: "mailto:admin@example.com",
  };
  // 見本の秘密鍵(実際の鍵ではない)
  const privateKey = "k".repeat(43);

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(sendNotification).mockReset();
  });

  it("送り先がない_秘密鍵を読まない", async () => {
    const load = vi.fn(async () => privateKey);
    expect(await sendToAll([], DAILY_MESSAGE, webPushSender(vapid, 60, load))).toEqual({
      sent: 0,
      failed: 0,
      gone: [],
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("パラメーターの名前で秘密鍵を読み_公開鍵と連絡先と合わせて送る", async () => {
    const send = vi.mocked(sendNotification).mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    const load = vi.fn(async () => privateKey);
    const summary = await sendToAll([target(1), target(2)], DAILY_MESSAGE, webPushSender(vapid, 60, load));
    expect(summary.sent).toBe(2);
    expect(load).toHaveBeenCalledWith(vapid.privateKeyParameter);
    expect(send.mock.calls[0]?.[2]?.vapidDetails).toEqual({
      subject: vapid.subject,
      publicKey: vapid.publicKey,
      privateKey,
    });
  });

  it("秘密鍵を読めない_1 件の失敗ではなく_送信の全体を失敗にし_原因を持ち出さない", async () => {
    const send = vi.mocked(sendNotification);
    const cause = `AccessDenied: ${vapid.privateKeyParameter}`;
    const sender = webPushSender(vapid, 60, async () => {
      throw new Error(cause);
    });
    const failure = await sendToAll([target(1)], DAILY_MESSAGE, sender).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VapidKeyUnavailableError);
    expect(String((failure as Error).message)).not.toContain(cause);
    expect((failure as Error).cause).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});
