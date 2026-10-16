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
  { name: "export", summary: "公開データの差分として書き出す" },
  { name: "run", summary: "実行を管理する(見積もり、記録、再開)" },
];
