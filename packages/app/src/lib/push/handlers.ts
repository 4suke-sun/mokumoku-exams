import { authenticateAdmin } from "@/lib/auth/admin.ts";
import type { Authenticated, GuardDeps } from "@/lib/auth/guard.ts";
import { guard, json } from "@/lib/auth/handlers.ts";
import { authorize, fail, readJsonBody, unavailable } from "@/lib/history/handlers.ts";
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

// エラー応答の形と種類は、履歴の API と同じ(`{ "error": "<種類>" }`。docs/app/data.md)。
// 利用者の識別子(`sub`)は、サーバー側で検証したものだけを使い、本文からは受け取らない。

/**
 * 管理者を、サーバー側で検証した ID トークンで確かめる(管理者の API と同じ `authenticateAdmin`)。
 * 管理者でなければ、未ログインは 401、ログインしている利用者は 403(`{ "error": "forbidden" }`)の応答を返す。
 */
async function authorizeAdmin(request: Request, deps: PushDeps): Promise<Authenticated | Response> {
  try {
    const admin = await authenticateAdmin(request.headers.get("cookie"), deps.auth);
    if (admin) return admin;
  } catch {
    // 検証できないときは、管理者として扱わない(通す側には倒さない)
  }
  const auth = await authorize(request, deps);
  return auth ? json({ error: "forbidden" }, 403, auth.setCookies) : fail("unauthorized", 401);
}

/**
 * 状態を変える操作の共通の入り口。JSON だけを受け付け、ログインと本文を確かめる。
 * `adminOnly` なら、管理者でなければ断る(本文は読まない)。
 */
async function accept(request: Request, deps: PushDeps, options: { adminOnly?: boolean } = {}) {
  const rejected = guard(request);
  if (rejected) return rejected;
  let auth: Authenticated;
  if (options.adminOnly) {
    const admin = await authorizeAdmin(request, deps);
    if (admin instanceof Response) return admin;
    auth = admin;
  } else {
    const user = await authorize(request, deps);
    if (!user) return fail("unauthorized", 401);
    auth = user;
  }
  const read = await readJsonBody(request, MAX_PUSH_BODY_BYTES, auth.setCookies);
  if (read instanceof Response) return read;
  return { auth, body: read.body };
}

/** 自分の端末の購読を保存する。同じ endpoint は上書き。1 人あたりの端末の数には上限がある。 */
export async function handleSubscribe(request: Request, deps: PushDeps): Promise<Response> {
  const accepted = await accept(request, deps);
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;
  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) return fail("bad-request", 400, auth.setCookies);
  const { endpoint, keys } = parsed.data;

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
  const accepted = await accept(request, deps);
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;
  const parsed = UnsubscribeSchema.safeParse(body);
  if (!parsed.success) return fail("bad-request", 400, auth.setCookies);

  try {
    await deps.repository.deleteSubscription(auth.user.sub, parsed.data.endpoint);
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
  const accepted = await accept(request, deps, { adminOnly: true });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;
  if (!TestNotificationSchema.safeParse(body).success) return fail("bad-request", 400, auth.setCookies);
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
