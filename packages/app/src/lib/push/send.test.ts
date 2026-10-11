import { describe, expect, it } from "vitest";
import { DAILY_MESSAGE, type PushTarget, readVapid, sendToAll } from "./send.ts";

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

describe("readVapid", () => {
  it("3 つそろっているときだけ_設定を返す", () => {
    const env = { VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:admin@example.com" };
    expect(readVapid(env)).toEqual({ publicKey: "public", privateKey: "private", subject: "mailto:admin@example.com" });
    expect(readVapid({ ...env, VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(readVapid({})).toBeNull();
  });
});
