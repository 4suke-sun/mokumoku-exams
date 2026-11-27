import { readCookies, sessionCookies, withTokenCookies } from "./session.ts";
import type { AuthProvider } from "./types.ts";
import type { TokenVerifier, VerifiedUser } from "./verify.ts";

export type GuardDeps = { verifier: TokenVerifier; provider: AuthProvider; secure: boolean };

export type Authenticated = {
  user: VerifiedUser;
  /** 更新したときだけ入る。応答に付ける Set-Cookie */
  setCookies: string[];
  /** 後続の処理に渡す Cookie ヘッダー(更新したときは、新しいトークンに差し替え済み) */
  cookieHeader: string;
};

/**
 * Cookie の ID トークンを、サーバー側で検証して利用者を得る。期限切れ(Cookie が消えた場合を含む)でも、
 * リフレッシュトークンで更新できれば、その場で更新して通す。どちらもだめなら null。
 */
export async function authenticate(cookieHeader: string | null, deps: GuardDeps): Promise<Authenticated | null> {
  const { id, refresh } = readCookies(cookieHeader);
  if (id) {
    const user = await deps.verifier.verifyIdToken(id);
    if (user) return { user, setCookies: [], cookieHeader: cookieHeader ?? "" };
  }
  if (!refresh) return null;
  try {
    const tokens = await deps.provider.refresh(refresh);
    const user = await deps.verifier.verifyIdToken(tokens.idToken);
    if (!user) return null;
    return {
      user,
      setCookies: sessionCookies(tokens, deps.secure),
      cookieHeader: withTokenCookies(cookieHeader, tokens),
    };
  } catch {
    return null;
  }
}

/**
 * ログインなしで呼べる認証の API。ログイン前・ログアウト後にも呼ばれ、トークンがなくても安全に応答するものだけを、
 * 1 つずつ列挙する(`change-password` のようにログインが必要なものは含めない。新しい API は、足さない限り保護される)。
 */
export const PUBLIC_AUTH_API_PATHS: ReadonlySet<string> = new Set(
  [
    "login",
    "new-password",
    "forgot-password",
    "reset-password",
    "refresh",
    "logout",
    "session",
    "sign-up",
    "confirm-sign-up",
    "resend-code",
  ].map((name) => `/api/auth/${name}`),
);

/**
 * ログインなしで開ける画面。ログインと登録に要る画面と、利用者のデータを使わない読み物(使い方、リリースノート、
 * 利用規約とプライバシーポリシー)と、お問い合わせの画面(送るにはログインが要り、送信の API は保護したまま)。
 * sitemap に載せるのも、この画面だけ。
 */
export const PUBLIC_PAGE_PATHS: ReadonlySet<string> = new Set([
  "/login",
  "/forgot-password",
  "/signup",
  "/privacy",
  "/help",
  "/release-notes",
  "/contact",
]);

/**
 * ログインなしで取れるファイル。ブラウザや検索エンジンが Cookie なしで取りに来るもの(マニフェスト、アイコン、
 * robots・sitemap、通知を受け取る Service Worker)と、ログインの画面に出すロゴを、1 つずつ列挙する。どれも秘密の情報を含まない。
 */
export const PUBLIC_FILE_PATHS: ReadonlySet<string> = new Set([
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  // ログインの画面でも、サイドバーと上部のバーに出す
  "/brand/logo-full.png",
  "/brand/mascot.png",
]);

/**
 * ログインなしで開けるか。公開する経路は、列挙した画面(`PUBLIC_PAGE_PATHS`)、認証の API(列挙したものだけ)、
 * 列挙したファイル、Next の静的ファイル(`/_next/`)に限る。大文字小文字は区別し、末尾のスラッシュや `..`・`%`・`\` を含むものは公開しない。
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname.includes("..") || pathname.includes("%") || pathname.includes("\\")) return false;
  return (
    PUBLIC_PAGE_PATHS.has(pathname) ||
    PUBLIC_AUTH_API_PATHS.has(pathname) ||
    PUBLIC_FILE_PATHS.has(pathname) ||
    pathname.startsWith("/_next/")
  );
}
