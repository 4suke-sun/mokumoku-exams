import { type NextRequest, NextResponse } from "next/server";
import { guardDeps } from "@/lib/auth/deps.ts";
import { authenticate, isPublicPath } from "@/lib/auth/guard.ts";
import { isOriginVerified, ORIGIN_VERIFY_HEADER } from "@/lib/origin-verify.ts";

const NO_STORE = { "cache-control": "no-store" };

/**
 * すべてのリクエストの入り口。
 * 1. CloudFront を通らないアクセス(Function URL への直接のアクセス)を、すべての経路で断る。
 * 2. ログインなしで開けるページ以外は、サーバー側で ID トークンを検証し、未ログインなら断る
 *    (画面はログイン画面へ、API は 401)。
 */
export async function proxy(request: NextRequest) {
  if (
    !isOriginVerified(
      process.env.ORIGIN_VERIFY_VALUE,
      request.headers.get(ORIGIN_VERIFY_HEADER),
      process.env.NODE_ENV === "production",
    )
  ) {
    return new NextResponse(null, { status: 403 });
  }

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  let auth: Awaited<ReturnType<typeof authenticate>>;
  try {
    auth = await authenticate(request.headers.get("cookie"), guardDeps());
  } catch {
    // 設定の不備など。通す側には倒さない
    return new NextResponse(null, { status: 503, headers: NO_STORE });
  }

  if (!auth) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
    }
    // 絶対 URL で返すと、Next が同じホストのものを相対の Location に直す(Host は Function URL のものだが、外には出ない)
    const login = new URL("/login", request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login, { status: 307, headers: NO_STORE });
  }

  if (auth.setCookies.length === 0) return NextResponse.next();
  // 更新したトークンを、後続の処理にも渡し、ブラウザにも返す
  const headers = new Headers(request.headers);
  headers.set("cookie", auth.cookieHeader);
  const response = NextResponse.next({ request: { headers } });
  for (const cookie of auth.setCookies) response.headers.append("set-cookie", cookie);
  return response;
}
