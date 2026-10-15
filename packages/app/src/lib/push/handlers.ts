import { acceptBody, fail, unavailable } from "@/lib/api/endpoint.ts";
import type { GuardDeps } from "@/lib/auth/guard.ts";
import { json } from "@/lib/auth/handlers.ts";
import type { PushRepository } from "./repository.ts";
import {
  MAX_PUSH_BODY_BYTES,
  MAX_SUBSCRIPTIONS_PER_USER,
  SubscribeSchema,
  TestNotificationSchema,
  UnsubscribeSchema,
} from "./schema.ts";
import { type PushSender, sendToAll, TEST_MESSAGE } from "./send.ts";

export type PushDeps = {
  auth: GuardDeps;
  repository: PushRepository;
  /** VAPID の設定がなければ null(テスト通知は 503。秘密鍵を読めないときも 503) */
  sender: PushSender | null;
  now?: () => number;
};

// エラー応答の形と種類は、ほかの API と同じ(`{ "error": "<種類>" }`。docs/app/data.md)。
// 利用者の識別子(`sub`)は、サーバー側で検証したものだけを使い、本文からは受け取らない。

/** 自分の端末の購読を保存する。同じ endpoint は上書き。1 人あたりの端末の数には上限がある。 */
export async function handleSubscribe(request: Request, deps: PushDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_PUSH_BODY_BYTES,
    body: SubscribeSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;
  const { endpoint, keys } = body;

  try {
    const existing = await deps.repository.listSubscriptions(auth.user.sub);
    const known = existing.some((target) => target.endpoint === endpoint);
    if (!known && existing.length >= MAX_SUBSCRIPTIONS_PER_USER) return fail("bad-request", 400, auth.setCookies);
    const createdAt = new Date((deps.now ?? Date.now)()).toISOString();
    await deps.repository.putSubscription(auth.user.sub, { endpoint, ...keys }, createdAt);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/** 自分の購読を消す。ほかの人の購読には届かない(自分の区画の中だけを消す)。 */
export async function handleUnsubscribe(request: Request, deps: PushDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_PUSH_BODY_BYTES,
    body: UnsubscribeSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;

  try {
    await deps.repository.deleteSubscription(auth.user.sub, body.endpoint);
    return json({ status: "deleted" }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/**
 * 自分の購読(すべての端末)に、テスト通知を送る。無効になった購読は消す。送れた数を返す。
 * 管理者だけが、自分にだけ送れる(管理者でなければ 403。送り先は、検証した `sub` の購読だけ)。
 */
export async function handleTestNotification(request: Request, deps: PushDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "admin",
    maxBytes: MAX_PUSH_BODY_BYTES,
    body: TestNotificationSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth } = accepted;
  if (!deps.sender) return fail("unavailable", 503);

  try {
    const targets = await deps.repository.listSubscriptions(auth.user.sub);
    const summary = await sendToAll(targets, TEST_MESSAGE, deps.sender);
    for (const target of summary.gone) await deps.repository.deleteSubscription(auth.user.sub, target.endpoint);
    return json({ sent: summary.sent }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}
