/**
 * ログの作法。環境値・鍵・本文を出さないために、出力は「種類」と「場所」だけにする。
 * 自由な文は受け取らない。種類は決まった語から選び、場所は項目名やファイルの位置だけを渡す。
 */
export type Kind =
  | "情報"
  | "未実装"
  | "設定の欠落"
  | "設定の不正"
  | "不明なコマンド"
  | "不明なオプション"
  | "内部の誤り"
  | "書き込みをしない(dry-run)";

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

export function report(output: Output, kind: Kind, where?: string): void {
  const line = where === undefined ? kind : `${kind}: ${where}`;
  (kind === "情報" || kind === "未実装" || kind === "書き込みをしない(dry-run)" ? output.out : output.err)(`${line}\n`);
}

/** 想定外の例外は、種類(クラス名)だけを出す。メッセージには値や本文が含まれうるので出さない */
export function reportInternalError(output: Output, error: unknown): void {
  report(output, "内部の誤り", error instanceof Error ? error.constructor.name : typeof error);
}
