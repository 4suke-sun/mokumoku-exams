"use client";

import { useEffect, useState } from "react";
import { listReleases } from "@/lib/release-notes.ts";
import {
  hasUnreadRelease,
  latestNotableVersion,
  loadSeenRelease,
  RELEASE_SEEN_EVENT,
  RELEASE_SEEN_KEY,
  saveSeenRelease,
} from "@/lib/release-seen.ts";
import { browserStore } from "@/lib/storage.ts";

const LATEST = latestNotableVersion(listReleases());

/** 利用者向けの新しい版を、まだ見ていないか。サーバーでの描画と最初の描画では、目印を出さない。 */
export function useUnreadRelease(): boolean {
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    const read = () => setUnread(hasUnreadRelease(loadSeenRelease(browserStore()), LATEST));
    const onStorage = (event: StorageEvent) => {
      if (event.key === RELEASE_SEEN_KEY) read();
    };
    read();
    window.addEventListener(RELEASE_SEEN_EVENT, read);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RELEASE_SEEN_EVENT, read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return unread;
}

/** リリースノートを開いたら、いちばん新しい利用者向けの版を、見たことにする。 */
export function MarkReleasesSeen() {
  useEffect(() => {
    if (LATEST === null) return;
    saveSeenRelease(browserStore(), LATEST);
    window.dispatchEvent(new Event(RELEASE_SEEN_EVENT));
  }, []);
  return null;
}

/** 未読の目印(点)。点は飾りにして、意味は読み上げ用の文字で伝える。 */
export function UnreadDot() {
  return (
    <>
      <span aria-hidden="true" className="unread-dot" />
      <span className="sr-only">(新しい更新があります)</span>
    </>
  );
}
