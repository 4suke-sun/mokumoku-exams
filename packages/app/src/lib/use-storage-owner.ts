"use client";

import { useSyncExternalStore } from "react";
import { storageOwner, subscribeStorageOwner } from "./storage.ts";

/**
 * いまの持ち主の印(`storage.ts` の `storageOwner`)。undefined は、まだ取れていない間。
 * 端末の記録を読む画面は、これを効果の依存に入れ、undefined の間は読み込み中のままにする(印が取れたら、読み直す)。
 * 持ち主の照合そのものは、`browserStore()` が行う。
 */
export function useStorageOwner(): string | null | undefined {
  return useSyncExternalStore(subscribeStorageOwner, storageOwner, () => undefined);
}
