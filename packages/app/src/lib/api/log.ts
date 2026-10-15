/** 失敗の記録の印。アプリのログのメトリクスフィルター(packages/infra/lib/web-stack.ts)が、この値で 5xx を数える */
export const API_FAILURE_EVENT = "api-failure";

// 例外の名前と経路は、形が決まったものだけを出す。外れたものは、固定の値に置き換える
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PATH = /^\/[A-Za-z0-9/_.-]{0,127}$/;

/**
 * API と入口(proxy)が 5xx を返した失敗を、1 行の JSON で標準エラーに出す。出すのは、経路(パスだけ。問い合わせの文字列は含めない)・
 * 返した状態・例外の名前だけ。例外のメッセージ・スタック・本文・利用者の識別子・入力の値は出さない
 * (docs/app/lessons/0002-no-raw-error-output.md)。
 */
export function logApiFailure(request: Request, status: number, error: unknown): void {
  const { pathname } = new URL(request.url);
  const record = {
    event: API_FAILURE_EVENT,
    path: PATH.test(pathname) ? pathname : "(other)",
    status,
    error: error instanceof Error && ERROR_NAME.test(error.name) ? error.name : "unknown",
  };
  console.error(JSON.stringify(record));
}
