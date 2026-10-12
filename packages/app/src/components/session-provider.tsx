"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchSession, postJson } from "@/lib/auth/client.ts";
import { refreshDelayMs } from "@/lib/auth/refresh.ts";
import { syncPrefs } from "@/lib/prefs-client.ts";

export type SessionState =
  | { status: "loading" }
  | { status: "signed-out" }
  // isAdmin: 管理者のナビゲーションを出すかどうか(表示のためだけ。認可はサーバーが行う)
  | { status: "signed-in"; email: string | null; expiresAt: number | null; isAdmin: boolean };

type Value = { state: SessionState; reload: () => Promise<void>; signOut: () => Promise<void> };

const SessionContext = createContext<Value>({
  state: { status: "loading" },
  reload: async () => {},
  signOut: async () => {},
});

export function useSession(): Value {
  return useContext(SessionContext);
}

/** ログイン状態を持ち、期限の前にトークンを更新する。更新できなければ、ログイン画面へ戻す。 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState>({ status: "loading" });
  const wasSignedIn = useRef(false);

  const reload = useCallback(async () => {
    const info = await fetchSession();
    // 取得できなかったとき(通信の失敗)は、いまの状態を変えない
    if (info === null) return;
    if (info.signedIn) {
      wasSignedIn.current = true;
      setState({ status: "signed-in", email: info.email, expiresAt: info.expiresAt, isAdmin: info.isAdmin === true });
    } else {
      setState({ status: "signed-out" });
      if (wasSignedIn.current) {
        wasSignedIn.current = false;
        router.push("/login");
      }
    }
  }, [router]);

  const signOut = useCallback(async () => {
    await postJson("/api/auth/logout", {});
    wasSignedIn.current = false;
    setState({ status: "signed-out" });
    router.push("/login");
    router.refresh();
  }, [router]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ログインしたら(ページを開き直したときも)、アカウントの表示の設定を、端末に反映する(別の端末で選んだ設定を引き継ぐ)。
  // 反映のあと、サーバーが次の描画から設定を使えるよう、アカウントの設定の Cookie は、この取得の応答で付く。
  const signedIn = state.status === "signed-in";
  const synced = useRef(false);
  useEffect(() => {
    if (!signedIn) {
      synced.current = false;
      return;
    }
    if (synced.current) return;
    synced.current = true;
    void syncPrefs();
  }, [signedIn]);

  const expiresAt = state.status === "signed-in" ? state.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const refresh = async () => {
      const result = await postJson("/api/auth/refresh", {});
      if (result.ok || result.status === 0 || result.status >= 500) {
        // 通信の失敗は、次の機会に再試行する。成功したら、新しい期限を読み直す
        if (result.ok) await reload();
        return;
      }
      wasSignedIn.current = false;
      setState({ status: "signed-out" });
      router.push("/login");
    };
    const timer = setTimeout(refresh, refreshDelayMs(expiresAt, Date.now()));
    // 長く閉じていたタブが戻ったときは、すぐ確認する
    const onVisible = () => {
      if (document.visibilityState === "visible" && refreshDelayMs(expiresAt, Date.now()) === 0) void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt, reload, router]);

  const value = useMemo(() => ({ state, reload, signOut }), [state, reload, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
