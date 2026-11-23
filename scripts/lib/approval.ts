import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decideSubagentCommand } from "./subagent-command.ts";

export type ApprovalKind = "push" | "pr" | "issue";

/** 人の承認 1 件。差分の内容や、検査で見つけた値は持たない。 */
export interface ApprovalEntry {
  kind: ApprovalKind;
  /** push と PR の承認の対象のブランチ。Issue は空。 */
  branch: string;
  /** 承認の時点の範囲の末尾のコミット。Issue は空。 */
  head: string;
  count: number;
  /** 範囲の起点(`<base>..HEAD` のコミット数を数える)。Issue は空。 */
  base: string;
  /** 承認した下書きのハッシュ。下書きのない push は空。 */
  draftHash: string;
  /** 下書きから取り出した題のハッシュ(題を直書きで渡す形の照合に使う)。古い印と push は持たない。 */
  titleHash?: string;
  /** 下書きから書き出した本文のファイルのハッシュ。古い印と push は持たない。 */
  bodyHash?: string;
  /** 有効期限(エポックミリ秒) */
  expiresAt: number;
}

export interface Approvals {
  entries: ApprovalEntry[];
}

/** 承認の有効期限。承認から実行までの間に、範囲や下書きが変わる余地を小さくする。 */
export const TTL_MS = 60 * 60 * 1000;
export const APPROVAL_FILE = "mokumoku-approvals.json";

const KINDS: ApprovalKind[] = ["push", "pr", "issue"];

export function approvalPath(gitCommonDir: string): string {
  return join(gitCommonDir, APPROVAL_FILE);
}

function isEntry(e: unknown): e is ApprovalEntry {
  const x = e as ApprovalEntry;
  return (
    typeof e === "object" &&
    e !== null &&
    KINDS.includes(x.kind) &&
    typeof x.branch === "string" &&
    typeof x.head === "string" &&
    typeof x.count === "number" &&
    typeof x.base === "string" &&
    typeof x.draftHash === "string" &&
    (x.titleHash === undefined || typeof x.titleHash === "string") &&
    (x.bodyHash === undefined || typeof x.bodyHash === "string") &&
    typeof x.expiresAt === "number"
  );
}

export function parseApprovals(text: string): Approvals {
  try {
    const parsed = JSON.parse(text) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return { entries: [] };
    return { entries: parsed.entries.filter(isEntry) };
  } catch {
    return { entries: [] };
  }
}

export function readApprovals(path: string): Approvals {
  return existsSync(path) ? parseApprovals(readFileSync(path, "utf8")) : { entries: [] };
}

export function writeApprovals(path: string, approvals: Approvals): void {
  writeFileSync(path, `${JSON.stringify(approvals, null, 2)}\n`);
}

/** 同じ種類・同じブランチの承認は、置き換える。期限切れは捨てる。 */
export function grant(approvals: Approvals, added: ApprovalEntry, now: number): Approvals {
  const kept = approvals.entries.filter(
    (e) => e.expiresAt > now && !(e.kind === added.kind && e.branch === added.branch),
  );
  return { entries: [...kept, added] };
}

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 下書きを、題と本文に分ける。1 行目が題(Issue は先頭の `# ` を除く)、3 行目以降が本文
 * (`head -n 1` と `tail -n +3` と同じ範囲)。
 */
export function splitDraft(text: string, kind: "pr" | "issue"): { title: string; body: string } {
  const lines = text.split("\n");
  const first = (lines[0] ?? "").replace(/\r$/, "");
  return { title: kind === "issue" ? first.replace(/^# /, "") : first, body: lines.slice(2).join("\n") };
}

/** 承認のときに書き出す、本文だけのファイルのパス(`<下書き>.md` → `<下書き>.body.md`)。 */
export function bodyPathFor(draft: string): string {
  return draft.endsWith(".md") ? `${draft.slice(0, -3)}.body.md` : `${draft}.body`;
}

/** 直書きの題に使えない文字。シェルが展開・解釈しうる文字を含む題は、`$(head …)` の形で渡す。 */
export const UNSAFE_TITLE = /[$`\\"'!]/;

/** 止める操作の種類。 */
export type Gate = {
  kind: ApprovalKind;
  command: string;
  /** push の送り先の指定(`origin` のあとの語)。`$(…)` などの動的な指定があるときは、空 */
  refspecs?: string[];
};

export interface Classified {
  gates: Gate[];
  /** 承認があっても通さない操作の理由 */
  forbidden: string[];
  /** 下書きのファイルとして、コマンドに現れたパス(`.drafts/` の下) */
  drafts: string[];
  /** HEAD やブランチを変える git の操作(`commit`、`switch` など)があるか */
  movesHead: boolean;
  /** 直書きの題(`--title`、`-t` の値。`$(…)` の形は含めない)。承認した下書きの題と照合する */
  titles: string[];
  /** 粗い区切りの判定で、直書きの題を見たか。細かい区切りで題を拾えなかったときに止めるため */
  coarseTitle?: boolean;
}

// 引用符の中の `;` や `&&` も区切りとして扱う。判定が厳しい側(止める側)にだけ倒れる。
const SEPARATORS = /[;|&\n`(){}]|\$\(/;
const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const DRAFT_PATH = /[^\s"'()<>|;&=]*\.drafts\/[^\s"')<>|;&]+/g;
const GIT_OPTIONS_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);
const MARKER = /mokumoku-approvals/;

/** `git [全体のオプション] <サブコマンド> <引数…>` を分ける。git でなければ null。 */
function splitGit(tokens: string[]): { sub: string; args: string[] } | null {
  if (tokens[0] !== "git") return null;
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i] ?? "";
    if (GIT_OPTIONS_WITH_VALUE.has(t)) i += 2;
    else if (t.startsWith("-")) i += 1;
    else break;
  }
  const sub = tokens[i];
  return sub ? { sub, args: tokens.slice(i + 1) } : null;
}

// 実行の前後で、HEAD やブランチが変わる git の操作。フックは実行の前の状態で照合するので、同じコマンドに置かせない
const HEAD_MOVING = new Set([
  "commit",
  "switch",
  "checkout",
  "reset",
  "merge",
  "rebase",
  "cherry-pick",
  "revert",
  "pull",
  "am",
]);

const SHORT_CLUSTER = (flag: string) => new RegExp(`^-[a-zA-Z]*${flag}[a-zA-Z]*$`);

/** 値の全体が、コマンド置換(`$(…)`、バッククォート)か。直書きの文字が続く形は、含めない。 */
function isSubstitution(value: string): boolean {
  return /^\$\(.*\)$/s.test(value) || /^`.*`$/s.test(value);
}

interface GhTextFlags {
  /** 題・本文を変えるオプションがあるか */
  editsText: boolean;
  /** 本文の直書き(`--body`、`-b`)があるか */
  inlineBody: boolean;
  /** 題の直書き(`--title`、`-t` に、`$(…)` でない値が続く形)の値 */
  inlineTitles: string[];
  /** 本文のファイル指定(`--body-file`、`-F`)の値。`<` は、`<(…)` の形 */
  bodyFiles: string[];
}

/**
 * gh の題・本文のオプションを拾う。短いオプションは、値が続く形(`-bX`、`-FX`)と、
 * 先頭に真偽値のオプション(`-d`、`-f`、`-w`、`-e`)が付く形(`-db`)も見る。
 */
function ghTextFlags(tokens: string[]): GhTextFlags {
  const flags: GhTextFlags = { editsText: false, inlineBody: false, inlineTitles: [], bodyFiles: [] };
  tokens.forEach((t, i) => {
    const eq = t.indexOf("=");
    const key = eq >= 0 ? t.slice(0, eq) : t;
    if (t.startsWith("--")) {
      if (key === "--title") {
        flags.editsText = true;
        // `--title "$(head …)"` の、`$(` で区切った細かい判定では、値の語が残らない
        const value = (eq >= 0 ? t.slice(eq + 1) : (tokens[i + 1] ?? "")).replace(/^["']+/, "");
        if (!isSubstitution(value)) flags.inlineTitles.push(value);
      }
      if (key === "--body") flags.editsText = flags.inlineBody = true;
      if (key === "--body-file") {
        flags.editsText = true;
        flags.bodyFiles.push(eq >= 0 ? t.slice(eq + 1) : (tokens[i + 1] ?? ""));
      }
      return;
    }
    const short = /^-[dfwe]*([btF])(.*)$/.exec(t);
    if (!short) return;
    flags.editsText = true;
    if (short[1] === "b") flags.inlineBody = true;
    // `-t "$(head …)"`(空白で離した値)は、`--title` と同じく、下書きから取る形として通す
    const titleValue = (short[2] || (tokens[i + 1] ?? "")).replace(/^=/, "");
    if (short[1] === "t" && !isSubstitution(titleValue)) flags.inlineTitles.push(titleValue);
    if (short[1] === "F") flags.bodyFiles.push(short[2] ? short[2].replace(/^=/, "") : (tokens[i + 1] ?? ""));
  });
  return flags;
}

/** `gh` の、オプション(`-R <リポジトリ>`、`--repo <リポジトリ>` を含む)以外の語。 */
function ghWords(tokens: string[]): string[] {
  const words: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i] ?? "";
    if (t === "-R" || t === "--repo") i += 1;
    else if (!t.startsWith("-")) words.push(t);
  }
  return words;
}

/** リダイレクト(`> file`、`2>&1`、`&> file`)の語を除く。送り先の指定と取り違えない。 */
function withoutRedirects(args: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (/^(\d*|&)>>?$|^\d*<$/.test(a)) i += 1;
    else if (!/^(\d*|&)>>?.|^\d*<./.test(a)) kept.push(a);
  }
  return kept;
}

/** `fine` は、括弧と引用符の外だけで区切った判定か。直書きの題の値は、こちらでだけ拾う(粗い区切りでは、題の中の括弧で値が切れる)。 */
function classifySegment(tokens: string[], out: Classified, fine: boolean): void {
  const git = splitGit(tokens);
  if (git && HEAD_MOVING.has(git.sub)) out.movesHead = true;
  if (git?.sub === "push") {
    // `$(…)` などの動的な指定より前の、静的な語だけを見る。remote の次からが、送るブランチの指定
    const dynamicAt = git.args.findIndex((a) => /[$`(]/.test(a));
    const staticArgs = withoutRedirects(dynamicAt >= 0 ? git.args.slice(0, dynamicAt) : git.args);
    const refspecs = dynamicAt >= 0 ? [] : staticArgs.filter((a) => !a.startsWith("-")).slice(1);
    out.gates.push({ kind: "push", command: "git push", refspecs });
    // 承認の印が覆うのは、フックを動かした作業ツリーだけ。別の作業ツリーを指す push は、そこで実行する
    if (tokens.some((t) => t === "-C" || t.startsWith("--git-dir") || t.startsWith("--work-tree"))) {
      out.forbidden.push("作業ツリーを指定する push(-C など)は、その作業ツリーの中で実行してください");
    }
    for (const a of git.args) {
      if (a === "--force" || a.startsWith("--force-") || SHORT_CLUSTER("f").test(a) || a.startsWith("+")) {
        out.forbidden.push("強制 push は、人が自分で実行する(理由を説明して承認を待つ)");
      }
      if (
        a === "--delete" ||
        a === "-d" ||
        a === "--tags" ||
        a === "--mirror" ||
        a === "--all" ||
        a === "--prune" ||
        a.startsWith(":")
      ) {
        out.forbidden.push("ブランチの削除と、タグ・全ブランチの push は、/dev-release か人が実行する");
      }
      if (a.includes("refs/tags/") || a === "--follow-tags")
        out.forbidden.push("タグの push は、/dev-release か人が実行する");
    }
  } else if (git?.sub === "commit") {
    if (git.args.some((a) => a === "--no-verify" || SHORT_CLUSTER("n").test(a))) {
      out.forbidden.push("コミットの検査(フック)を飛ばす指定は、人が自分で実行する");
    }
  } else if (tokens[0] === "gh") {
    const words = ghWords(tokens);
    const [area, action] = [words[0], words[1]];
    const kind = area === "pr" ? "pr" : area === "issue" ? "issue" : null;
    // ラベルやマイルストーンだけの編集は、本文が残らない軽い操作として、承認の印を要しない
    const text = ghTextFlags(tokens);
    if (kind && (action === "create" || action === "new" || (action === "edit" && text.editsText))) {
      out.gates.push({ kind, command: `gh ${area} ${action}` });
      if (text.inlineBody) {
        out.forbidden.push(
          "本文は、承認した下書きのファイルから渡してください(--body-file)。直書きの本文は、照合できません",
        );
      }
      // 本文の出どころ(テンプレート、復元)や、PR のヘッドのブランチを変えるオプションは、承認した下書きと照合できない
      if (tokens.some((t) => /^(--template|--recover|--head)(=|$)/.test(t) || /^-[dfwe]*[TH]/.test(t))) {
        out.forbidden.push(
          "本文の出どころや PR のヘッドを変えるオプション(--template、--recover、--head など)は使えません",
        );
      }
      // 直書きの題は、承認した下書きの題とハッシュで照合する(decideGate)。シェルが解釈しうる文字を含む題は、照合した値と実際の題がずれうる
      // 粗い区切りでは、`--title "$(…)"` の値が空に切れるので、値の検査と照合は、細かい区切りの側でだけ行う
      if (fine && text.inlineTitles.some((t) => t === "" || t.startsWith("-") || UNSAFE_TITLE.test(t))) {
        out.forbidden.push(
          '題の直書きには、空の値、- で始まる値、$ ` \\ " \' ! を含む値を使えません。--title "$(head -n 1 <下書き>)" の形で渡してください',
        );
      }
      if (fine) out.titles.push(...text.inlineTitles);
      else if (text.inlineTitles.some((t) => t !== "")) out.coarseTitle = true;
      // 承認した下書きと照合できるのは、本文のファイルが 1 つで、相対の .drafts/ の下にあるときだけ
      const fromDrafts = (v: string) =>
        v === "<" || v.startsWith("<(") || (v.startsWith(".drafts/") && !v.includes(".."));
      if (text.bodyFiles.length > 1 || !text.bodyFiles.every(fromDrafts)) {
        out.forbidden.push("本文のファイル指定は 1 つだけにして、.drafts/ の下の相対パスで渡してください");
      }
    }
  }
}

// コマンドの前に付く、シェルの予約語。外して判定する
const RESERVED = new Set(["then", "do", "else", "elif", "if", "while", "until", "!"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash"]);
// 先頭に付けて、あとのコマンドをそのまま実行するもの。外して判定する。値は、値を取るオプション(`sudo -u <ユーザー>` など)
const WRAPPERS: Record<string, string[]> = {
  env: ["-u", "-C", "-S"],
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U"],
  command: [],
  nohup: [],
  time: [],
  exec: [],
  builtin: [],
  nice: ["-n"],
  xargs: ["-n", "-I", "-L", "-P", "-d", "-E", "-s"],
  timeout: ["-k", "-s"],
  caffeinate: ["-t", "-w"],
  setsid: [],
};
// 位置引数(期間)を 1 つ取るラッパー
const TAKES_DURATION = new Set(["timeout"]);

/** `/usr/bin/git`、`\git` のような、パスや先頭の記号つきの呼び方を、コマンド名にそろえる。 */
function commandName(token: string): string {
  return (token.replace(/^\\/, "").split("/").pop() ?? token).replace(/^["']|["']$/g, "");
}

/** 先頭のラッパー(`env`、`sudo` とそのオプション・環境変数)を外す。コマンド名はそろえる。 */
function stripWrappers(tokens: string[]): string[] {
  const rest = [...tokens];
  for (;;) {
    if (rest[0] && RESERVED.has(rest[0])) {
      rest.shift();
      continue;
    }
    if (rest[0] && !ENV_ASSIGN.test(rest[0])) rest[0] = commandName(rest[0]);
    const head = rest[0];
    const withValue = head !== undefined && Object.hasOwn(WRAPPERS, head) ? WRAPPERS[head] : undefined;
    if (head && ENV_ASSIGN.test(head)) rest.shift();
    else if (withValue) {
      rest.shift();
      while (rest[0] && (rest[0].startsWith("-") || ENV_ASSIGN.test(rest[0]))) {
        const option = rest.shift() ?? "";
        if (withValue.includes(option)) rest.shift();
      }
      if (head && TAKES_DURATION.has(head) && rest[0] && /^\d/.test(rest[0])) rest.shift();
    } else return rest;
  }
}

// サブシェル(`$(…)`、`<(…)`)と引用符の中では区切らない。`--title "$(head … | sed …)" --body-file <(…)` の、あとのフラグを取りこぼさないため
const LEADING_SUBSHELL = /^(\$\(|[({`])+/;

/** コマンドを、括弧と引用符の外にある `&&`・`||`・`;`・`|`・`&`・改行で分ける。リダイレクトの `&`(`2>&1`、`&>`)は区切らない。 */
function splitTopLevel(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  // "top" は括弧と引用符の外。"sub" は括弧の中、"dq"・"sq" は二重・単一引用符の中
  const stack: ("sub" | "dq" | "sq")[] = [];
  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? "";
    const next = command[i + 1] ?? "";
    const top = stack[stack.length - 1];
    if (top === "sq") {
      if (c === "'") stack.pop();
    } else if (top === "dq") {
      if (c === "\\") {
        current += c + next;
        i++;
        continue;
      }
      if (c === '"') stack.pop();
      else if (c === "$" && next === "(") {
        stack.push("sub");
        current += "$(";
        i++;
        continue;
      }
    } else if (c === "'") stack.push("sq");
    else if (c === '"') stack.push("dq");
    else if (c === "(") stack.push("sub");
    else if (c === ")" && top === "sub") stack.pop();
    else if (stack.length === 0) {
      const prev = command[i - 1] ?? "";
      const pair = c + next;
      const redirect = c === "&" && (prev === ">" || prev === "<" || next === ">");
      if (pair === "&&" || pair === "||") {
        parts.push(current);
        current = "";
        i++;
        continue;
      }
      if ((c === ";" || c === "|" || c === "\n" || c === "&") && !redirect) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

/**
 * 空白で語に分ける。引用符と括弧の中の空白では分けない(`NAME="a b" git push`、`git -c "a b" commit`)。
 * 語の前後の引用符は外し、語の途中のリダイレクト(`push>/dev/null`)は別の語に分ける。
 */
function shellTokens(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  const stack: ("sub" | "dq" | "sq")[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? "";
    const next = text[i + 1] ?? "";
    const top = stack[stack.length - 1];
    if (top === "sq") {
      if (c === "'") stack.pop();
    } else if (top === "dq") {
      if (c === "\\") {
        current += c + next;
        i++;
        continue;
      }
      if (c === '"') stack.pop();
      else if (c === "$" && next === "(") {
        stack.push("sub");
        current += "$(";
        i++;
        continue;
      }
    } else if (c === "'") stack.push("sq");
    else if (c === '"') stack.push("dq");
    else if (c === "(") stack.push("sub");
    else if (c === ")" && top === "sub") stack.pop();
    else if (/\s/.test(c) && stack.length === 0) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current) tokens.push(current);
  return tokens
    .flatMap((t) => {
      const m = /^([^<>&"'$`()]+)([<>].*)$/.exec(t);
      return m && !/^\d+$/.test(m[1] ?? "") ? [m[1] ?? "", m[2] ?? ""] : [t];
    })
    .map((t) => t.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
}

function classifyInto(command: string, out: Classified, depth: number): void {
  for (const part of splitTopLevel(command)) {
    const tokens = stripWrappers(shellTokens(part.replace(LEADING_SUBSHELL, "")));
    if (tokens.length > 0) classifySegment(tokens, out, true);
  }
  for (const segment of command.split(SEPARATORS)) {
    const tokens = stripWrappers(
      segment
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/^["']+|["']+$/g, ""))
        .filter(Boolean),
    );
    const shell = tokens[0];
    // `bash --norc -c "…"` のように、オプションを挟んでも -c を見つける
    const cIndex = shell && SHELLS.has(shell) ? tokens.findIndex((t, i) => i > 0 && /^-[a-zA-Z]*c$/.test(t)) : -1;
    if (cIndex > 0 && depth < 3) {
      // `bash -c "git push"` の中身を、別のコマンドとして判定し直す
      const inner = tokens.slice(cIndex + 1).join(" ");
      classifyInto(inner.replace(/^["']|["']$/g, ""), out, depth + 1);
    } else if (tokens.length > 0) classifySegment(tokens, out, false);
  }
}

/** Bash のコマンド 1 行から、承認が要る操作と、通さない操作を拾う。 */
export function classifyCommand(command: string): Classified {
  const out: Classified = { gates: [], forbidden: [], drafts: [], movesHead: false, titles: [] };
  classifyInto(command, out, 0);
  // 粗い区切りでだけ直書きの題が見えた形は、照合する値を取れないので、通さない
  if (out.coarseTitle && out.titles.length === 0 && out.gates.some((g) => g.kind !== "push")) {
    out.forbidden.push("題の値を読み取れません。題は、引用符で囲んで 1 つの語として渡してください");
  }
  delete out.coarseTitle;
  out.titles = [...new Set(out.titles)];
  // 粗い区切りと細かい区切りの両方で判定するので、同じ結果の重なりを除く
  out.gates = [
    ...new Map(out.gates.map((g) => [`${g.kind} ${g.command} ${(g.refspecs ?? []).join(",")}`, g])).values(),
  ];
  out.forbidden = [...new Set(out.forbidden)];
  const paths = [...new Set(command.match(DRAFT_PATH) ?? [])];
  // 承認した下書きと照合できるのは、作業ツリーの直下の .drafts/ を、相対パスで指したときだけ
  if (out.gates.length > 0 && paths.some((d) => !d.startsWith(".drafts/") || d.includes(".."))) {
    out.forbidden.push("下書きは、作業ツリーの直下の .drafts/ を、相対パスで渡してください");
  }
  if (out.gates.length > 0 && out.movesHead) {
    out.forbidden.push(
      "commit・switch などと、push・PR・Issue の操作は、別のコマンドにしてください(照合は実行の前の状態で行います)",
    );
  }
  // 判定は、フックを動かした作業ツリーで取る。cd で別の作業ツリーへ移ってからの操作は、照合できない
  if (
    out.gates.length > 0 &&
    /(^|[;&|\n({!"']|\b(?:then|do|else|elif|if|while|until|command|builtin|time|exec)\s)\s*(cd|pushd)\s/.test(command)
  ) {
    out.forbidden.push("cd のあとの push・PR・Issue の操作は、作業ツリーの中で、cd せずに実行してください");
  }
  out.drafts = paths;
  return out;
}

/** コマンドが、承認の印のファイルの名前を含むか。印は `scripts/approval.ts` だけが書き、その呼び出しにはファイル名が出ない。 */
export function touchesMarkerDirectly(command: string): boolean {
  return MARKER.test(command);
}

/** フックが、いまの作業ツリーについて調べる値。 */
export interface Probe {
  branch: string;
  head: string;
  /** `<base>..HEAD` のコミット数。数えられなければ null */
  countFrom: (base: string) => number | null;
  /** 下書きのファイルのハッシュ。読めなければ null */
  hashOf: (path: string) => string | null;
}

export type Decision = { ok: true } | { ok: false; reason: string };

const deny = (reason: string): Decision => ({ ok: false, reason });

/** 承認の種類ごとに、満たす承認があるか。push は、PR の承認でも通す(PR の承認は push を含む)。 */
function acceptedKinds(kind: ApprovalKind): ApprovalKind[] {
  return kind === "push" ? ["push", "pr"] : [kind];
}

/** push の指定(`<名前>`、`<元>:<先>`、`HEAD`)が、現在のブランチを同じ名前で送るものか。 */
function pushesCurrentBranch(refspec: string, branch: string): boolean {
  const heads = (name: string) => name.replace(/^refs\/heads\//, "");
  const [src, dst] = refspec.includes(":") ? (refspec.split(":", 2) as [string, string]) : [refspec, refspec];
  if (src === "HEAD" && dst === "HEAD") return true;
  return heads(dst) === branch && (heads(src) === branch || src === "HEAD");
}

export function decideGate(
  gate: Gate,
  drafts: string[],
  approvals: Approvals,
  now: number,
  probe: Probe,
  titles: string[] = [],
): Decision {
  const live = approvals.entries.filter((e) => e.expiresAt > now && acceptedKinds(gate.kind).includes(e.kind));
  if (live.length === 0) {
    return deny(
      `${gate.command} は、人の承認が要ります(承認の印がない、または有効期限が切れています)。スキルの手順で承認を得てから、承認の印を書いてください`,
    );
  }
  if (gate.kind === "issue") return checkDrafts(live, drafts, probe, titles);
  const stray = (gate.refspecs ?? []).find((r) => !pushesCurrentBranch(r, probe.branch));
  if (stray !== undefined) {
    return deny(
      `push の送り先(${stray})が、承認したブランチ(${probe.branch})と違います。承認したブランチだけを送ってください`,
    );
  }
  const sameRange = live.filter(
    (e) => e.branch === probe.branch && e.head === probe.head && probe.countFrom(e.base) === e.count,
  );
  if (sameRange.length === 0) {
    return deny(
      `${gate.command} の範囲(ブランチ、末尾のコミット、コミット数)が、承認のときと違います。検査と承認をやり直してください`,
    );
  }
  return gate.kind === "pr" ? checkDrafts(sameRange, drafts, probe, titles) : { ok: true };
}

/**
 * コマンドに出る下書き(下書きの全体か、承認のときに書き出した本文のファイル)と、直書きの題が、
 * 同じ 1 件の承認に収まるか。
 */
function checkDrafts(entries: ApprovalEntry[], drafts: string[], probe: Probe, titles: string[]): Decision {
  // 承認した下書きと照合できないコマンドは、通さない(スキルの手順は、必ず下書きのファイルから投稿する)
  if (drafts.length === 0)
    return deny("下書きのファイル(.drafts/ の下)から投稿してください。承認した下書きと照合できません");
  const hashes = drafts.map((d) => probe.hashOf(d));
  const titleHashes = titles.map((t) => sha256(t));
  const draftsMatch = (e: ApprovalEntry) => {
    const approved = new Set([e.draftHash, e.bodyHash ?? ""].filter(Boolean));
    return hashes.every((h) => h !== null && approved.has(h));
  };
  const titlesMatch = (e: ApprovalEntry) => titleHashes.every((h) => e.titleHash !== undefined && h === e.titleHash);
  if (!entries.some(draftsMatch)) {
    return deny("下書きの内容が、承認のときと違います(または読めません)。検査と承認をやり直してください");
  }
  if (!entries.some((e) => draftsMatch(e) && titlesMatch(e))) {
    return deny(
      "直書きの題が、承認した下書きの題と違います(または、印が題を覆っていません)。承認のときに表示した題を、そのまま渡してください",
    );
  }
  return { ok: true };
}

export interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string; file_path?: string };
  /** サブエージェントの中から呼ばれたときだけ付く */
  agent_id?: string;
  /** サブエージェントの役(エージェント定義の名前)。付かないときは、作成役・読み取り役の判定(scripts/lib/subagent-command.ts)をしない */
  agent_type?: string;
}

/**
 * PreToolUse の判定。承認が要る操作を、承認の印なしでは通さない。
 * 権限の確認を省く動作モードでも、フックの終了コード 2 で止める。
 */
export function decideHook(input: HookInput, approvals: () => Approvals, now: number, probe: () => Probe): Decision {
  const isSubagent = typeof input.agent_id === "string" && input.agent_id !== "";
  if (input.tool_name === "Write" || input.tool_name === "Edit") {
    const target = input.tool_input?.file_path ?? "";
    return MARKER.test(target) ? deny("承認の印は、scripts/approval.ts だけが書きます") : { ok: true };
  }
  if (input.tool_name !== "Bash") return { ok: true };
  const command = input.tool_input?.command;
  // 入力の形が変わって、コマンドが読めないときは、素通りさせない
  if (typeof command !== "string") return deny("コマンドを読めないため、止めました");
  if (touchesMarkerDirectly(command)) return deny("承認の印は、scripts/approval.ts だけが書きます");
  if (isSubagent && /scripts\/approval\.ts\s+grant/.test(command)) {
    return deny("サブエージェントは、承認の印を書けません。人の承認を受けるのは、メインのセッションです");
  }
  // 作成役は、定義が許すコマンドを 1 つだけ、1 行だけ。読み取り役は、読み取りのコマンドをパイプでつなぐ形だけ(agent_id と役の名前が入力にあるときだけ)
  if (isSubagent) {
    const byRole = decideSubagentCommand(input.agent_type, command);
    if (!byRole.ok) return byRole;
  }
  const classified = classifyCommand(command);
  if (classified.forbidden.length > 0) return deny(classified.forbidden[0] ?? "止める操作です");
  if (classified.gates.length === 0) return { ok: true };
  if (isSubagent) {
    return deny(
      "push、PR・Issue の作成・編集は、サブエージェントからは実行しません。メインのセッションが、人の承認のあとに行います",
    );
  }
  const p = probe();
  for (const gate of classified.gates) {
    const decision = decideGate(gate, classified.drafts, approvals(), now, p, classified.titles);
    if (!decision.ok) return decision;
  }
  return { ok: true };
}
