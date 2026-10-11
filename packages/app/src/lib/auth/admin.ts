import { type Authenticated, authenticate, type GuardDeps } from "./guard.ts";
import type { VerifiedUser } from "./verify.ts";

/**
 * 管理者のグループ名。packages/infra の `ADMIN_GROUP_NAME`(UserPool のグループ)と同じ値で、両方のテストで値を固定している。
 */
export const ADMIN_GROUP = "admins";

/** 管理者か。サーバー側で検証した ID トークンの `cognito:groups` だけで決める(クライアントの申告は使わない)。 */
export function isAdmin(user: VerifiedUser): boolean {
  return user.groups.includes(ADMIN_GROUP);
}

const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/i;

/**
 * 管理者だけが開ける経路か(画面の `/admin` 以下と、API の `/api/admin` 以下)。
 * 符号化(`%61` など)、大文字小文字、重なったスラッシュの違いでは外れないように、ならしてから比べる。
 * ならせない(符号化が壊れている)経路は、管理者の経路として扱う(通す側には倒さない)。
 */
export function isAdminPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return ADMIN_PATH.test(decoded.replace(/[\\/]+/g, "/"));
}

/**
 * Cookie の ID トークンを、サーバー側で検証し、管理者なら利用者を返す。未ログイン・管理者でないときは null。
 * 管理者の画面(レイアウト)と、管理者の API の本体が、入口(proxy)とは別に、この関数で確かめる。
 */
export async function authenticateAdmin(cookieHeader: string | null, deps: GuardDeps): Promise<Authenticated | null> {
  const auth = await authenticate(cookieHeader, deps);
  return auth && isAdmin(auth.user) ? auth : null;
}
