import { getHistoryRepository } from "@/lib/history/repository.ts";
import { getPushRepository } from "@/lib/push/repository.ts";
import { authDeps } from "./deps.ts";
import type { DeleteAccountDeps } from "./handlers.ts";
import { getTokenVerifier } from "./index.ts";

/**
 * 退会の API の依存。利用者の区画のデータ(学習の記録と通知の購読)を消す。
 * 入口(proxy)が読む deps.ts に、保存先の読み込みを持ち込まないよう、別のファイルに置く。
 */
export function deleteAccountDeps(): DeleteAccountDeps {
  const history = getHistoryRepository();
  const push = getPushRepository();
  return {
    ...authDeps(),
    verifier: getTokenVerifier(),
    async purge(sub) {
      // 本番は同じテーブルの同じ区画なので、前者で購読も消える。手元の代替は保存先が別なので、両方を消す
      await history.deleteUserData(sub);
      await push.deleteAllSubscriptions(sub);
    },
  };
}
