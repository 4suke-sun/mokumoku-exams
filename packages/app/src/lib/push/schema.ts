import { z } from "zod";
import { isPushServiceEndpoint, MAX_ENDPOINT_LENGTH } from "./endpoint.ts";

/** 購読の API の本文の上限(endpoint と鍵だけなので、小さい) */
export const MAX_PUSH_BODY_BYTES = 4_000;

/** 1 人が購読できる端末(ブラウザ)の数の上限。送信の量を抑える。 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

/** 鍵は base64url(ブラウザの `PushSubscription.toJSON()` の形)。 */
const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+={0,2}$/);

const endpoint = z
  .string()
  .max(MAX_ENDPOINT_LENGTH)
  .refine(isPushServiceEndpoint, "プッシュサービスの URL ではありません。");

/**
 * 購読する。本文は `{ endpoint, keys: { p256dh, auth } }` だけ。利用者の識別子(`sub`)は、未知の項目として断る。
 * p256dh は公開鍵(65 バイト)、auth は 16 バイトの値を、base64url にしたもの。
 */
export const SubscribeSchema = z.strictObject({
  endpoint,
  keys: z.strictObject({ p256dh: base64url(80, 100), auth: base64url(16, 32) }),
});

/** 購読をやめる。本文は `{ endpoint }` だけ。 */
export const UnsubscribeSchema = z.strictObject({ endpoint });

/** テスト通知。本文は空のオブジェクト(`{}`)だけ。 */
export const TestNotificationSchema = z.strictObject({});
