import { describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { handleSubscribe, handleTestNotification, handleUnsubscribe, type PushDeps } from "./handlers.ts";
import { createMemoryPushRepository, type PushRepository } from "./repository.ts";
import { MAX_SUBSCRIPTIONS_PER_USER } from "./schema.ts";
import { type PushSender, type PushTarget, type SendOutcome, webPushSender } from "./send.ts";

const ORIGIN = "http://localhost";

/** トークンの文字列から利用者を決める検証(署名の検証そのものは verify.test.ts で確かめる) */
const verifier: TokenVerifier = {
  async verifyIdToken(token) {
    if (!token.startsWith("token-")) return null;
    const sub = token.slice("token-".length);
    // `admin-` で始まる利用者だけを、管理者のグループに入れる
    return { sub, groups: sub.startsWith("admin-") ? ["admins"] : [] };
  },
};
const noRefresh = {
  async refresh() {
    throw new Error("unavailable");
  },
} as unknown as AuthProvider;

/** 送った先と中身を記録する送信。endpoint ごとに結果を決められる。 */
function recordingSender(outcomes: Record<string, SendOutcome> = {}) {
  const sent: { target: PushTarget; payload: string }[] = [];
  const send: PushSender = async (target, payload) => {
    sent.push({ target, payload });
    return outcomes[target.endpoint] ?? "sent";
  };
  return { sent, send };
}

function deps(repository: PushRepository = createMemoryPushRepository(), sender: PushSender | null = null): PushDeps {
  return { auth: { verifier, provider: noRefresh, secure: false }, repository, sender, now: () => 0 };
}

const asUser = (sub: string) => `mokumoku_id=token-${sub}`;
const endpointOf = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;
const subscription = (n = 1) => ({
  endpoint: endpointOf(n),
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});

function request(path: string, method: string, value: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(value),
  });
}
const put = (value: unknown, headers: Record<string, string> = {}) =>
  request("/api/push/subscription", "PUT", value, headers);
const del = (value: unknown, headers: Record<string, string> = {}) =>
  request("/api/push/subscription", "DELETE", value, headers);
const test = (value: unknown, headers: Record<string, string> = {}) =>
  request("/api/push/test", "POST", value, headers);

describe("購読の API の認証", () => {
  it("未ログイン_購読・解除・テスト通知を 401 で断り_何も保存しない", async () => {
    const repository = createMemoryPushRepository();
    const d = deps(repository, recordingSender().send);
    expect((await handleSubscribe(put(subscription()), d)).status).toBe(401);
    expect((await handleUnsubscribe(del({ endpoint: endpointOf(1) }), d)).status).toBe(401);
    expect((await handleTestNotification(test({}), d)).status).toBe(401);
    expect((await handleSubscribe(put(subscription(), { cookie: "mokumoku_id=forged" }), d)).status).toBe(401);
    expect(await repository.listSubscriptions("forged")).toEqual([]);
  });

  it("JSON でない形式と別サイトからの送信_断る", async () => {
    const d = deps();
    const form = new Request(`${ORIGIN}/api/push/subscription`, {
      method: "PUT",
      headers: { "content-type": "text/plain", cookie: asUser("user-a") },
      body: JSON.stringify(subscription()),
    });
    expect((await handleSubscribe(form, d)).status).toBe(415);
    const cross = put(subscription(), { cookie: asUser("user-a"), "sec-fetch-site": "cross-site" });
    expect((await handleSubscribe(cross, d)).status).toBe(403);
  });
});

describe("購読する", () => {
  it("自分の区画に保存し_同じ endpoint は上書きになる", async () => {
    const repository = createMemoryPushRepository();
    const d = deps(repository);
    expect((await handleSubscribe(put(subscription(), { cookie: asUser("user-a") }), d)).status).toBe(200);
    expect((await handleSubscribe(put(subscription(), { cookie: asUser("user-a") }), d)).status).toBe(200);
    expect(await repository.listSubscriptions("user-a")).toEqual([
      { endpoint: endpointOf(1), p256dh: "B".repeat(87), auth: "a".repeat(22) },
    ]);
    expect(await repository.listSubscriptions("user-b")).toEqual([]);
  });

  it.each([
    ["利用者の識別子を本文に入れる", { ...subscription(), sub: "user-b" }],
    ["鍵に未知の項目を入れる", { ...subscription(), keys: { ...subscription().keys, owner: "user-b" } }],
    ["http の endpoint", { ...subscription(), endpoint: "http://fcm.googleapis.com/fcm/send/x" }],
    ["既知のプッシュサービスでない endpoint", { ...subscription(), endpoint: "https://example.com/push" }],
    ["内部のアドレスの endpoint", { ...subscription(), endpoint: "https://169.254.169.254/latest" }],
    ["似たホストの endpoint", { ...subscription(), endpoint: "https://fcm.googleapis.com.example.com/x" }],
    ["鍵が base64url でない", { ...subscription(), keys: { p256dh: "*".repeat(87), auth: "a".repeat(22) } }],
    ["鍵がない", { endpoint: endpointOf(1) }],
  ])("%s_400 で断り_保存しない", async (_name, value) => {
    const repository = createMemoryPushRepository();
    const response = await handleSubscribe(put(value, { cookie: asUser("user-a") }), deps(repository));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad-request" });
    expect(await repository.listSubscriptions("user-a")).toEqual([]);
    expect(await repository.listSubscriptions("user-b")).toEqual([]);
  });

  it("本文が JSON でない・大きすぎる_断る", async () => {
    const d = deps();
    const broken = request("/api/push/subscription", "PUT", null, { cookie: asUser("user-a") }, "{");
    expect((await handleSubscribe(broken, d)).status).toBe(400);
    const large = request("/api/push/subscription", "PUT", null, { cookie: asUser("user-a") }, "x".repeat(5000));
    expect((await handleSubscribe(large, d)).status).toBe(413);
  });

  it("端末の数が上限に達している_新しい endpoint は断り_登録済みの endpoint は上書きできる", async () => {
    const repository = createMemoryPushRepository();
    const d = deps(repository);
    for (let n = 1; n <= MAX_SUBSCRIPTIONS_PER_USER; n++) {
      expect((await handleSubscribe(put(subscription(n), { cookie: asUser("user-a") }), d)).status).toBe(200);
    }
    const over = await handleSubscribe(
      put(subscription(MAX_SUBSCRIPTIONS_PER_USER + 1), { cookie: asUser("user-a") }),
      d,
    );
    expect(over.status).toBe(400);
    expect((await handleSubscribe(put(subscription(1), { cookie: asUser("user-a") }), d)).status).toBe(200);
    expect(await repository.listSubscriptions("user-a")).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
  });

  it("保存先の失敗_503 を返し_原因は返さない", async () => {
    const failing: PushRepository = {
      ...createMemoryPushRepository(),
      async listSubscriptions() {
        throw new Error("table-example is unavailable");
      },
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handleSubscribe(put(subscription(), { cookie: asUser("user-a") }), deps(failing));
    const lines = log.mock.calls.map((call) => call.map(String).join(" "));
    log.mockRestore();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("table-example");
    // 記録は、経路・状態・例外の名前だけ(原因のメッセージと利用者の識別子は出さない)
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "api-failure", path: "/api/push/subscription", status: 503, error: "Error" },
    ]);
    expect(lines.join("\n")).not.toContain("table-example");
    expect(lines.join("\n")).not.toContain("user-a");
  });
});

describe("購読をやめる", () => {
  it("自分の購読だけを消し_ほかの人の同じ endpoint の購読は残る", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("user-a", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    await repository.putSubscription("user-b", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    const response = await handleUnsubscribe(
      del({ endpoint: endpointOf(1) }, { cookie: asUser("user-b") }),
      deps(repository),
    );
    expect(response.status).toBe(200);
    expect(await repository.listSubscriptions("user-b")).toEqual([]);
    expect(await repository.listSubscriptions("user-a")).toHaveLength(1);
  });

  it("利用者の識別子を本文に入れる_400 で断り_何も消さない", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("user-a", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    const body = { endpoint: endpointOf(1), sub: "user-a" };
    expect((await handleUnsubscribe(del(body, { cookie: asUser("user-b") }), deps(repository))).status).toBe(400);
    expect(await repository.listSubscriptions("user-a")).toHaveLength(1);
  });
});

describe("テスト通知", () => {
  it("管理者でない利用者_403 で断り_自分の購読にも送らない", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("user-a", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    const sender = recordingSender();
    const response = await handleTestNotification(
      test({}, { cookie: asUser("user-a") }),
      deps(repository, sender.send),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(sender.sent).toEqual([]);
  });

  it("管理者でない利用者が_管理者だと申告する_本文・ヘッダー・Cookie のどれも使われない", async () => {
    const sender = recordingSender();
    const d = deps(createMemoryPushRepository(), sender.send);
    const claims = [
      test({ admin: true }, { cookie: asUser("user-a") }),
      test({}, { cookie: asUser("user-a"), "x-user-groups": "admins" }),
      test({}, { cookie: `${asUser("user-a")}; cognito:groups=admins` }),
    ];
    for (const claim of claims) expect((await handleTestNotification(claim, d)).status).toBe(403);
    expect(sender.sent).toEqual([]);
  });

  it("自分の購読(すべての端末)にだけ送り_ほかの人には送らない", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("admin-a", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    await repository.putSubscription("admin-a", { endpoint: endpointOf(2), p256dh: "p", auth: "a" }, "t");
    await repository.putSubscription("user-b", { endpoint: endpointOf(3), p256dh: "p", auth: "a" }, "t");
    const sender = recordingSender();
    const response = await handleTestNotification(
      test({}, { cookie: asUser("admin-a") }),
      deps(repository, sender.send),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2 });
    expect(sender.sent.map((s) => s.target.endpoint).sort()).toEqual([endpointOf(1), endpointOf(2)]);
    expect(JSON.parse(sender.sent[0]?.payload ?? "{}")).toMatchObject({ title: expect.any(String), url: "/account" });
  });

  it("無効になった購読_送れた数に入れず_消す", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("admin-a", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    await repository.putSubscription("admin-a", { endpoint: endpointOf(2), p256dh: "p", auth: "a" }, "t");
    const sender = recordingSender({ [endpointOf(2)]: "gone" });
    const response = await handleTestNotification(
      test({}, { cookie: asUser("admin-a") }),
      deps(repository, sender.send),
    );
    expect(await response.json()).toEqual({ sent: 1 });
    expect((await repository.listSubscriptions("admin-a")).map((t) => t.endpoint)).toEqual([endpointOf(1)]);
  });

  it("利用者の識別子を本文に入れる_400 で断り_送らない", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("user-b", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    const sender = recordingSender();
    const response = await handleTestNotification(
      test({ sub: "user-b" }, { cookie: asUser("admin-a") }),
      deps(repository, sender.send),
    );
    expect(response.status).toBe(400);
    expect(sender.sent).toEqual([]);
  });

  it("鍵が設定されていない_503 を返す", async () => {
    const response = await handleTestNotification(test({}, { cookie: asUser("admin-a") }), deps());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("秘密鍵を読めない_503 を返し_原因もパラメーターの名前も応答に出さない", async () => {
    const repository = createMemoryPushRepository();
    await repository.putSubscription("admin-a", { endpoint: endpointOf(1), p256dh: "p", auth: "a" }, "t");
    const parameter = "/example/push/vapid-private-key";
    const sender = webPushSender(
      { publicKey: "P".repeat(87), privateKeyParameter: parameter, subject: "mailto:admin@example.com" },
      60,
      async () => {
        throw new Error(`AccessDenied: ${parameter}`);
      },
    );
    const response = await handleTestNotification(test({}, { cookie: asUser("admin-a") }), deps(repository, sender));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain(parameter);
    // 送れなかった購読は、消さずに残す
    expect(await repository.listSubscriptions("admin-a")).toHaveLength(1);
  });
});
