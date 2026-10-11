// ブラウザ側の、プッシュ通知の購読の操作。通知を受け取る Service Worker は public/sw.js。

/** Service Worker の場所。範囲(scope)をサイト全体にするため、直下に置く。 */
export const SERVICE_WORKER_PATH = "/sw.js";

/** このブラウザで、プッシュ通知を使えるか(Service Worker、Push API、通知の許可の仕組みがそろっている)。 */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  );
}

/** VAPID の公開鍵(base64url)を、購読に渡すバイト列にする。 */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** この端末のいまの購読。なければ null。 */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function send(method: "PUT" | "DELETE" | "POST", path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return null;
  }
}

export type SubscribeOutcome = "subscribed" | "denied" | "failed";

/**
 * 通知の許可を求め、購読して、アカウントに保存する。保存できなければ、ブラウザの購読も取り消す
 * (画面の状態と、サーバーの状態をそろえる)。
 */
export async function subscribePush(publicKey: string): Promise<SubscribeOutcome> {
  try {
    if ((await Notification.requestPermission()) !== "granted") return "denied";
    await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
    const { endpoint, keys } = subscription.toJSON();
    const response = await send("PUT", "/api/push/subscription", { endpoint, keys });
    if (response?.ok) return "subscribed";
    await subscription.unsubscribe().catch(() => undefined);
    return "failed";
  } catch {
    return "failed";
  }
}

/** この端末の購読をやめる。ブラウザの購読を先に取り消す(サーバーに残っても、送信のときに無効として消える)。 */
export async function unsubscribePush(): Promise<boolean> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return true;
    const { endpoint } = subscription;
    if (!(await subscription.unsubscribe())) return false;
    await send("DELETE", "/api/push/subscription", { endpoint });
    return true;
  } catch {
    return false;
  }
}

/** 自分の購読に、テスト通知を送る。送れた数。失敗したら null。 */
export async function sendTestNotification(): Promise<number | null> {
  const response = await send("POST", "/api/push/test", {});
  if (!response?.ok) return null;
  try {
    const body = (await response.json()) as { sent?: unknown };
    return typeof body.sent === "number" ? body.sent : null;
  } catch {
    return null;
  }
}
