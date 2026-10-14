import { createHash } from "node:crypto";

/**
 * 持ち主の印。利用者の識別子(`sub`)の SHA-256 の先頭 16 文字(識別子そのものには戻せない)。
 * 設定の Cookie の照合(`prefs-cookie.ts`)と、端末の記録の持ち主の照合(`storage.ts`)に使う。サーバーだけが作る。
 */
export function ownerTag(sub: string): string {
  return createHash("sha256").update(sub).digest("hex").slice(0, 16);
}
