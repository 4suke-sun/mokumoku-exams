/**
 * サブエージェントの Bash の呼び出しを、作成役(エージェント定義の名前)ごとに確かめる判定。PreToolUse のフック(scripts/approval-hook.ts)が使う。
 * 副作用のない関数にして単体テストする。コマンドは、引用符とバックスラッシュを 1 文字ずつ追って字句に分けてから見る(lex)。
 *
 * - 作成役(commit-writer・draft-writer): 定義(.claude/agents/)の「Bash で実行してよいのは」に挙げたコマンドを、1 つだけ、1 行だけ通す。
 *   次を含むコマンドは通さない: 改行(行の継続の `\` を含む)、閉じない引用符と末尾の `\`、引用符の外の演算子
 *   (`;`・`&`・`|`・`<`・`>`・括弧・`` ` ``。ヒアドキュメント `<<`・`<<<` を含む)、`$`(変数の展開、コマンドの置換、`$'…'`。二重引用符の中を含む)、
 *   引用符の外で `#` から始まる語(コメント)、引用符の外の `{`・`}`(波括弧の展開で、語を字面からずらす形)、`git -C`・`git -c`、`--output`。
 * - ほかの役(読み取り役を含む)と、役の名前が入力にないとき: この判定では止めない(承認の判定は、別に行う)。
 *   読み取り役の書き込みは、別の Issue で扱う(いまは定義の決まりだけ)。
 */

/** 作成役ごとに、Bash で実行してよいコマンド(先頭の語。git は副コマンドまで)。定義の記述と、テストで突き合わせる。 */
export const WRITER_ALLOWED_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  "commit-writer": ["git diff", "git log", "git show", "git status", "git rev-parse"],
  "draft-writer": ["git diff", "git log", "git show", "git status", "git rev-parse", "cat", "ls", "grep"],
};

export type SubagentDecision = { ok: true } | { ok: false; reason: string };

interface Lexed {
  /** 語(引用符とバックスラッシュを外したもの) */
  words: string[];
  /** 引用符の外の演算子の文字(`;`・`&`・`|`・`<`・`>`・`(`・`)`・`` ` ``) */
  operator: boolean;
  /** 引用符の外か二重引用符の中にある `$`、二重引用符の中の `` ` `` */
  expansion: boolean;
  /** 引用符の外で `#` から始まる語 */
  comment: boolean;
  /** 引用符の外の `{`・`}`(波括弧の展開) */
  brace: boolean;
  /** 閉じない引用符、末尾のバックスラッシュ */
  unterminated: boolean;
}

const OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "`"]);

/** 1 行のコマンドを、引用符とバックスラッシュを 1 文字ずつ追って、語に分ける。 */
export function lex(command: string): Lexed {
  const out: Lexed = {
    words: [],
    operator: false,
    expansion: false,
    comment: false,
    brace: false,
    unterminated: false,
  };
  let word = "";
  let inWord = false;
  let state: "none" | "single" | "double" = "none";
  const endWord = () => {
    if (inWord) out.words.push(word);
    word = "";
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (state === "single") {
      if (c === "'") state = "none";
      else word += c;
      continue;
    }
    if (state === "double") {
      const next = command[i + 1];
      if (c === "\\" && next !== undefined && '$`"\\'.includes(next)) {
        word += next;
        i++;
      } else if (c === '"') state = "none";
      else {
        if (c === "$" || c === "`") out.expansion = true;
        word += c;
      }
      continue;
    }
    if (c === "\\") {
      const next = command[i + 1];
      if (next === undefined) out.unterminated = true;
      else {
        word += next;
        inWord = true;
        i++;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      state = c === "'" ? "single" : "double";
      inWord = true;
      continue;
    }
    if (c === " " || c === "\t") {
      endWord();
      continue;
    }
    if (OPERATORS.has(c)) {
      out.operator = true;
      endWord();
      continue;
    }
    if (c === "$") out.expansion = true;
    if (c === "#" && !inWord) out.comment = true;
    if (c === "{" || c === "}") out.brace = true;
    word += c;
    inWord = true;
  }
  if (state !== "none") out.unterminated = true;
  endWord();
  return out;
}

function writerDecision(agentType: string, allowed: readonly string[], command: string): SubagentDecision {
  const deny = (why: string): SubagentDecision => ({
    ok: false,
    reason: `${agentType} の Bash は、定義が許すコマンド(${allowed.join(" / ")})を、1 つだけ、1 行だけ実行します(${why})。ファイルの読み取りは Read、編集は Write ツールを使い、集計や機械検査はメインのセッションに任せてください`,
  });
  if (/[\n\r]/.test(command)) return deny("改行を含む");
  const lexed = lex(command);
  if (lexed.unterminated) return deny("閉じない引用符か、末尾のバックスラッシュを含む");
  if (lexed.expansion) return deny("変数の展開かコマンドの置換を含む");
  if (lexed.operator) return deny("連結・パイプ・リダイレクト・括弧を含む");
  if (lexed.comment) return deny("コメントを含む");
  if (lexed.brace) return deny("引用符の外の波括弧を含む");
  const ws = lexed.words;
  const head = ws[0] === "git" ? `git ${ws[1] ?? ""}` : (ws[0] ?? "");
  if (!allowed.includes(head)) return deny("許可の一覧の外のコマンド");
  // 差分を、出力の代わりにファイルへ書く形
  if (ws.some((w) => w === "--output" || w.startsWith("--output="))) return deny("ファイルへ書き出すオプションを含む");
  return { ok: true };
}

/** サブエージェントの Bash のコマンドを、作成役のときだけ確かめる。 */
export function decideSubagentCommand(agentType: string | undefined, command: string): SubagentDecision {
  if (agentType === undefined || agentType === "") return { ok: true };
  const allowed = WRITER_ALLOWED_COMMANDS[agentType];
  return allowed === undefined ? { ok: true } : writerDecision(agentType, allowed, command);
}
