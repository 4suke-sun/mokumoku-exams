/**
 * ログインの前後で画面を移るときは、ページごと読み込み直す。
 * クライアントの遷移(`router.push`)は、ログインの前に先読みした結果(ログイン画面への転送)を使い回すことがあり、
 * ログインしたあとも、ログイン画面に留まってしまう。
 */
export function navigateWithReload(path: string): void {
  window.location.assign(path);
}
