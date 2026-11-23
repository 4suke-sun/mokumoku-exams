/**
 * 読み取り役のサブエージェントの Bash の呼び出しを、役(エージェント定義の名前)ごとに確かめる判定。PreToolUse のフック(scripts/approval-hook.ts)が使う。
 * 副作用のない関数にして単体テストする。コマンドは、引用符とバックスラッシュを 1 文字ずつ追って字句に分けてから見る(lex)。
 *
 * - 読み取り役(書き込みの道具を持たない組み込みの役。READONLY_ROLES): 読み取りのコマンド(READONLY_ALLOWED_COMMANDS)だけを、
 *   パイプ(`|`)と `2>/dev/null` でつなぐ形に限って通す。許可リスト方式で、書き込みになる形を拒否リストで追わない。
 *   次を含むコマンドは通さない: 改行(行の継続の `\` を含む)、閉じない引用符と末尾の `\`、`$`(変数の展開、コマンドの置換、`$'…'`。二重引用符の中を含む)、
 *   引用符の外で `#` から始まる語(コメント)、引用符の外の `{`・`}`(波括弧の展開で、語を字面からずらす形)、`--output`、
 *   パイプと `2>/dev/null` の外の演算子(`;`・`&`・`<`・`>`・括弧・`` ` ``。ヒアドキュメント `<<`・`<<<` を含む)、
 *   `find` の書き込み・起動・削除のオプション(`-exec`・`-delete`・`-fprint` など)、許可の一覧の外のコマンド(`git -C`・`git -c` を含む)。
 * - ほかの役と、役の名前が入力にないとき: この判定では止めない(承認の判定は、別に行う)。
 */

/** 読み取り役の名前(書き込みの道具を持たない組み込みの役。定義ファイルがないので、一覧の出どころはここ)。CONTRIBUTING.md と、テストで突き合わせる。 */
export const READONLY_ROLES: readonly string[] = ["Explore", "Plan"];

/** 読み取り役が Bash で実行してよいコマンド(先頭の語。git は副コマンドまで)。CONTRIBUTING.md と、テストで突き合わせる。 */
export const READONLY_ALLOWED_COMMANDS: readonly string[] = [
  "cat",
  "head",
  "tail",
  "grep",
  "ls",
  "wc",
  "find",
  "git diff",
  "git log",
  "git show",
  "git status",
  "git rev-parse",
  "git ls-files",
  "git ls-tree",
  "git cat-file",
];

/** `find` で、ファイルへ書く・別のコマンドを起動する・消すオプション */
const FIND_WRITING_OPTIONS = new Set(["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fls"]);

export type SubagentDecision = { ok: true } | { ok: false; reason: string };

interface Lexed {
  /** 語(引用符とバックスラッシュを外したもの) */
  words: string[];
  /** 引用符の外か二重引用符の中にある `$`、二重引用符の中の `` ` `` */
  expansion: boolean;
  /** 引用符の外で `#` から始まる語 */
  comment: boolean;
  /** 引用符の外の `{`・`}`(波括弧の展開) */
  brace: boolean;
  /** 閉じない引用符、末尾のバックスラッシュ */
  unterminated: boolean;
  /** 引用符の外の演算子(`;`・`&`・`|`・`<`・`>`・`(`・`)`・`` ` ``)の 1 文字ごとの、種類と、コマンドの文字列の中の位置 */
  ops: { char: string; at: number }[];
}

const OPERATORS = new Set([";", "&", "|", "<", ">", "(", ")", "`"]);

/** 1 行のコマンドを、引用符とバックスラッシュを 1 文字ずつ追って、語に分ける。 */
export function lex(command: string): Lexed {
  const out: Lexed = {
    words: [],
    expansion: false,
    comment: false,
    brace: false,
    unterminated: false,
    ops: [],
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
      out.ops.push({ char: c, at: i });
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

const isBlank = (c: string | undefined): boolean => c === undefined || c === " " || c === "\t";

/** 通す演算子(単独の `|` と、`2>/dev/null`)で、コマンドをパイプの区間に分ける。ほかの演算子があれば null。 */
function splitReadonlySegments(command: string, ops: Lexed["ops"]): string[] | null {
  const segments: string[] = [];
  let current = "";
  let pos = 0;
  for (const { char, at } of ops) {
    if (char === "|") {
      if (command[at - 1] === "|" || command[at + 1] === "|") return null;
      current += command.slice(pos, at);
      segments.push(current);
      current = "";
      pos = at + 1;
    } else if (char === ">") {
      const start = at - 1;
      const end = at + 1 + "/dev/null".length;
      const sink = command[start] === "2" && isBlank(command[start - 1]) && command.startsWith("/dev/null", at + 1);
      if (!sink || !isBlank(command[end])) return null;
      current += command.slice(pos, start);
      pos = end;
    } else return null;
  }
  segments.push(current + command.slice(pos));
  return segments;
}

function readonlyDecision(agentType: string, command: string): SubagentDecision {
  const deny = (why: string): SubagentDecision => ({
    ok: false,
    reason: `${agentType} の Bash は、読み取りのコマンド(${READONLY_ALLOWED_COMMANDS.join(" / ")})を、パイプ(|)と 2>/dev/null だけでつなぐ形で実行します(${why})。ファイルの読み取りは Read、検索は Grep・Glob を使い、書き込みや許可の外のコマンドが要るときは、メインのセッションに任せてください`,
  });
  if (/[\n\r]/.test(command)) return deny("改行を含む");
  const lexed = lex(command);
  if (lexed.unterminated) return deny("閉じない引用符か、末尾のバックスラッシュを含む");
  if (lexed.expansion) return deny("変数の展開かコマンドの置換を含む");
  if (lexed.comment) return deny("コメントを含む");
  if (lexed.brace) return deny("引用符の外の波括弧を含む");
  const segments = splitReadonlySegments(command, lexed.ops);
  if (segments === null) return deny("パイプと 2>/dev/null の外の演算子を含む");
  for (const segment of segments) {
    const ws = lex(segment).words;
    if (ws.length === 0) return deny("空のコマンドを含む");
    const head = ws[0] === "git" ? `git ${ws[1] ?? ""}` : (ws[0] ?? "");
    if (!READONLY_ALLOWED_COMMANDS.includes(head)) return deny("許可の一覧の外のコマンド");
    if (ws.some((w) => w === "--output" || w.startsWith("--output=")))
      return deny("ファイルへ書き出すオプションを含む");
    if (head === "find" && ws.some((w) => FIND_WRITING_OPTIONS.has(w) || w.startsWith("-fprint"))) {
      return deny("find の書き込み・起動・削除のオプションを含む");
    }
  }
  return { ok: true };
}

/** サブエージェントの Bash のコマンドを、読み取り役のときだけ確かめる。 */
export function decideSubagentCommand(agentType: string | undefined, command: string): SubagentDecision {
  if (agentType === undefined || agentType === "") return { ok: true };
  return READONLY_ROLES.includes(agentType) ? readonlyDecision(agentType, command) : { ok: true };
}
