"use client";

import { useEffect, useState } from "react";
import { Notice, type NoticeKind } from "@/components/notice.tsx";
import {
  currentSubscription,
  pushSupported,
  sendTestNotification,
  subscribePush,
  unsubscribePush,
} from "@/lib/push/client.ts";

type Status = "loading" | "unavailable" | "unsupported" | "off" | "on";

/**
 * 通知の購読の切り替え(アカウントの画面)。`publicKey` は VAPID の公開鍵。設定されていなければ null。
 * `canSendTest` は、テスト通知のボタンを出すかどうか(管理者にだけ出す。表示のためだけで、許可は API が決める)。
 */
export function PushSettings({ publicKey, canSendTest = false }: { publicKey: string | null; canSendTest?: boolean }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: NoticeKind; text: string } | null>(null);

  useEffect(() => {
    if (!publicKey) return setStatus("unavailable");
    if (!pushSupported()) return setStatus("unsupported");
    let active = true;
    currentSubscription()
      .then((subscription) => active && setStatus(subscription ? "on" : "off"))
      .catch(() => active && setStatus("off"));
    return () => {
      active = false;
    };
  }, [publicKey]);

  async function subscribe() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    const outcome = await subscribePush(publicKey);
    setBusy(false);
    if (outcome === "subscribed") {
      setStatus("on");
      setMessage({ kind: "success", text: "この端末で、通知を受け取るようにしました。" });
    } else if (outcome === "denied") {
      setMessage({
        kind: "error",
        text: "通知が許可されていません。ブラウザの設定で、このサイトの通知を許可してから、もう一度お試しください。",
      });
    } else {
      setMessage({ kind: "error", text: "通知を設定できませんでした。時間をおいて、もう一度お試しください。" });
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setMessage(null);
    const ok = await unsubscribePush();
    setBusy(false);
    if (ok) {
      setStatus("off");
      setMessage({ kind: "success", text: "この端末の通知を止めました。" });
    } else {
      setMessage({ kind: "error", text: "通知を止められませんでした。時間をおいて、もう一度お試しください。" });
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const sent = await sendTestNotification();
    setBusy(false);
    setMessage(
      sent === null
        ? { kind: "error", text: "テスト通知を送れませんでした。時間をおいて、もう一度お試しください。" }
        : sent > 0
          ? { kind: "success", text: "テスト通知を送りました。" }
          : { kind: "info", text: "送り先の端末がありません。通知を受け取る設定を、もう一度お試しください。" },
    );
  }

  const button =
    "rounded-md border border-line px-4 py-2 font-bold hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="space-y-3">
      <h2 className="h2">通知</h2>
      <p className="text-sm text-muted">学習のリマインドを、毎日 1 回、この端末に通知します。</p>
      {status === "loading" ? <p className="text-muted">確かめています…</p> : null}
      {status === "unavailable" ? <p className="text-muted">この環境では、通知を設定できません。</p> : null}
      {status === "unsupported" ? <p className="text-muted">このブラウザは、通知に対応していません。</p> : null}
      {status === "off" || status === "on" ? (
        <>
          <p>{status === "on" ? "この端末で、通知を受け取っています。" : "この端末では、通知を受け取っていません。"}</p>
          <div className="flex flex-wrap gap-3">
            {status === "on" ? (
              <>
                <button type="button" className={button} onClick={unsubscribe} disabled={busy}>
                  通知を止める
                </button>
                {canSendTest ? (
                  <button type="button" className={button} onClick={test} disabled={busy}>
                    テスト通知を送る
                  </button>
                ) : null}
              </>
            ) : (
              <button type="button" className={button} onClick={subscribe} disabled={busy}>
                通知を受け取る
              </button>
            )}
          </div>
        </>
      ) : null}
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
    </div>
  );
}
