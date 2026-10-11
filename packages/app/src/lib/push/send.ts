import webpush from "web-push";

// 送信の処理。アプリのテスト通知の API と、毎日の送信の Lambda(daily.ts)が共通で使う。
// Lambda にも載せるため、`@/` を使わない(endpoint.ts を参照)。

/** 送り先(ブラウザの購読)。鍵は、通知の本文の暗号化に使う。 */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

/** 通知の中身。`url` は、通知を押したときに開く、このサイトの画面。 */
export type PushMessage = { title: string; body: string; url: string };

/** VAPID の鍵と連絡先。値は .env から渡し、リポジトリには書かない。 */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

/** 1 件の結果。`gone` は、購読が無効になった(プッシュサービスが 404 か 410 を返した)。 */
export type SendOutcome = "sent" | "gone" | "failed";

/** 1 件を送る(テストで差し替える)。 */
export type PushSender = (target: PushTarget, payload: string) => Promise<SendOutcome>;

/** 毎日の通知。学習のリマインド。 */
export const DAILY_MESSAGE: PushMessage = {
  title: "もくもく問題集",
  body: "今日の 1 問を解いてみませんか。",
  url: "/exams",
};

/** テスト通知。 */
export const TEST_MESSAGE: PushMessage = {
  title: "もくもく問題集",
  body: "テスト通知です。この端末で通知を受け取れます。",
  url: "/account",
};

/** プッシュサービスが、届けられないときに通知を保つ時間(秒)。毎日の通知は、翌日までに届かなければ不要。 */
export const DAILY_TTL_SECONDS = 12 * 60 * 60;
export const TEST_TTL_SECONDS = 10 * 60;

/** 同時に送る数 */
const SEND_CONCURRENCY = 10;

/** 環境変数から VAPID の設定を読む。3 つそろっていなければ null(通知を送らない)。 */
export function readVapid(env: Record<string, string | undefined>): VapidConfig | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** web-push で送る。失敗の原因(応答の本文など)は返さず、種類だけにする。 */
export function webPushSender(vapid: VapidConfig, ttlSeconds: number): PushSender {
  return async (target, payload) => {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        payload,
        { vapidDetails: vapid, TTL: ttlSeconds, timeout: 10_000 },
      );
      return "sent";
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      return status === 404 || status === 410 ? "gone" : "failed";
    }
  };
}

export type SendSummary = { sent: number; failed: number; gone: PushTarget[] };

/** 送り先のすべてに、同じ通知を送る。無効になった購読は `gone` に集める(呼び出し側が消す)。 */
export async function sendToAll(
  targets: readonly PushTarget[],
  message: PushMessage,
  send: PushSender,
): Promise<SendSummary> {
  const payload = JSON.stringify(message);
  const summary: SendSummary = { sent: 0, failed: 0, gone: [] };
  for (let i = 0; i < targets.length; i += SEND_CONCURRENCY) {
    const chunk = targets.slice(i, i + SEND_CONCURRENCY);
    const outcomes = await Promise.all(chunk.map((target) => send(target, payload)));
    outcomes.forEach((outcome, index) => {
      if (outcome === "sent") summary.sent++;
      else if (outcome === "failed") summary.failed++;
      else summary.gone.push(chunk[index] as PushTarget);
    });
  }
  return summary;
}
