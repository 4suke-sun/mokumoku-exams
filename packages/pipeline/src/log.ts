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
  | "書き込みをしない(dry-run)"
  | "入力の誤り"
  | "資格マスタの誤り"
  | "計画の誤り"
  | "台帳の誤り"
  | "件数の上限"
  | "取得"
  | "出典の検査"
  | "出典の変化"
  | "確認できない出典"
  | "再検証の印"
  | "試験ガイドの抽出の依頼"
  | "試験ガイドの抽出の保留"
  | "試験ガイドの取り込みの停止"
  | "試験ガイドの差分"
  | "事実カードの誤り"
  | "事実カードの依頼"
  | "事実カードの出力なし"
  | "事実カードの取り込みの停止"
  | "事実カードの不採用"
  | "事実カードの保留"
  | "事実カードの本文なし"
  | "再試行の上限"
  | "カバレッジ"
  | "カバレッジの抜け"
  | "レビューレポート"
  | "問題データの誤り"
  | "出題計画の誤り"
  | "出題計画";

/** 標準出力に出す種類。ほかは標準エラーに出す */
const OUT_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  "情報",
  "未実装",
  "書き込みをしない(dry-run)",
  "取得",
  "出典の変化",
  "確認できない出典",
  "再検証の印",
  "試験ガイドの抽出の依頼",
  "試験ガイドの差分",
  "事実カードの依頼",
  "事実カードの不採用",
  "事実カードの保留",
  "カバレッジ",
  "カバレッジの抜け",
  "レビューレポート",
  "出題計画",
]);

export interface Output {
  out(text: string): void;
  err(text: string): void;
}

export function report(output: Output, kind: Kind, where?: string): void {
  const line = where === undefined ? kind : `${kind}: ${where}`;
  (OUT_KINDS.has(kind) ? output.out : output.err)(`${line}\n`);
}

/** 想定外の例外は、種類(クラス名)だけを出す。メッセージには値や本文が含まれうるので出さない */
export function reportInternalError(output: Output, error: unknown): void {
  report(output, "内部の誤り", error instanceof Error ? error.constructor.name : typeof error);
}
