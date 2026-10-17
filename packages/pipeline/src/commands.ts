export interface CommandSpec {
  name: string;
  summary: string;
}

/** 段階ごとのコマンド。各段階の版で、実装を足す */
export const COMMANDS: readonly CommandSpec[] = [
  { name: "collect", summary: "一次情報を集め、台帳に記録する" },
  { name: "facts", summary: "出典から事実カードを作る" },
  { name: "plan", summary: "出題の計画を立てる" },
  { name: "draft", summary: "問題の下書きを作る" },
  { name: "verify", summary: "下書きを検証する" },
  { name: "export", summary: "承認した下書きを data/ に書き出す" },
  { name: "eval", summary: "検証役の見落としと誤検出を測る" },
  { name: "reasons", summary: "不採用と差し戻しの理由を集計する(記録は変えない)" },
  { name: "status", summary: "段階ごとの状態を表示する(読むだけ)" },
];
