/**
 * ログイン後に戻る場所。ログイン画面の `next` は外部の入力なので、このサイト内の画面だけを受け付ける
 * (別のサイトへ誘導する `//example.com` や `/\\example.com`、制御文字を含む値は、トップに戻す)。
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を弾くための検査
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return "/";
  // ログインに関わる画面と API には戻さない(繰り返しの移動を避ける)
  if (
    value === "/login" ||
    value.startsWith("/login?") ||
    value.startsWith("/forgot-password") ||
    value.startsWith("/signup")
  )
    return "/";
  if (value.startsWith("/api/")) return "/";
  return value;
}
