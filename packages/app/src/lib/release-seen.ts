import type { KeyValueStore } from "./storage.ts";

// リリースノートの未読の目印。最後に見た版を端末に持ち、利用者向けの新しい版があれば、ナビに目印を出す。

export const RELEASE_SEEN_KEY = "mokumoku:v1:release-seen";
/** 見た版が変わったことを、同じ画面の中の部品に知らせるイベント */
export const RELEASE_SEEN_EVENT = "mokumoku:release-seen";

type ReleaseLike = { version: string; items: readonly { type: string }[] };

/** 利用者向けの項目(開発者向け `dev` 以外)を含む、いちばん新しい版。開発者向けだけの版は、未読にしない。 */
export function latestNotableVersion(releases: readonly ReleaseLike[]): string | null {
  return releases.find((release) => release.items.some((item) => item.type !== "dev"))?.version ?? null;
}

/** 未読があるか。見た版は、見たときの「いちばん新しい利用者向けの版」なので、一致しなければ新しい版が出ている。 */
export function hasUnreadRelease(seen: string | null, latest: string | null): boolean {
  return latest !== null && seen !== latest;
}

export function loadSeenRelease(store: KeyValueStore): string | null {
  try {
    return store.getItem(RELEASE_SEEN_KEY);
  } catch {
    return null;
  }
}

export function saveSeenRelease(store: KeyValueStore, version: string): void {
  try {
    store.setItem(RELEASE_SEEN_KEY, version);
  } catch {
    // 保存が禁止されていても、表示は続ける
  }
}
