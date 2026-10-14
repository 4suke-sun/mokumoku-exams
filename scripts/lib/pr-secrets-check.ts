/**
 * commit / push / PR・Issue 下書きの前に使う、機密情報・環境固有の値・個人情報の検査。
 * 履歴やリモートに載った値は消しにくいため、手前の段階で止める。
 * 純粋な関数にして単体テストする。報告には値を載せず、場所(ファイル:行)と種類だけを返す。
 */

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export interface CheckResult {
  blocks: string[];
  warns: string[];
}

export interface CommitAuthor {
  sha: string;
  authorEmail: string;
  committerEmail: string;
}

interface Pattern {
  name: string;
  re: RegExp;
}

interface FilenamePattern extends Pattern {
  /** このパターンに一致していれば、一致していても許可する(例: .env.example) */
  allow?: RegExp;
}

export const SENSITIVE_FILENAME_PATTERNS: FilenamePattern[] = [
  { name: ".env ファイル", re: /(^|\/)\.env(\..+)?$/, allow: /\.env\.(example|sample)$/ },
  { name: "credentials.json", re: /(^|\/)credentials\.json$/ },
  { name: "秘密鍵ファイル", re: /(^|\/)id_(rsa|ed25519|dsa|ecdsa)$/ },
  { name: "鍵・証明書ファイル", re: /\.(pem|key|p12|pfx|keystore)$/ },
  { name: "クラウド認証情報ファイル", re: /(^|\/)\.aws\/credentials$/ },
];

// 変更範囲の検査: 作業の成果物ではないもの(エディタ設定、下書き、手元専用の設定など)。
export const UNEXPECTED_PATH_PATTERNS: Pattern[] = [
  { name: "エディタの設定", re: /(^|\/)(\.vscode|\.idea)\// },
  { name: "下書き置き場", re: /(^|\/)\.drafts\// },
  { name: "pipeline の作業用の置き場(取得した本文など)", re: /(^|\/)pipeline-work\// },
  { name: "手元専用の設定", re: /(^|\/)\.claude\/settings\.local\.json$/ },
  { name: "拒否リスト", re: /(^|\/)\.pr-secrets-denylist$/ },
  { name: "OS の一時ファイル", re: /(^|\/)\.DS_Store$/ },
  { name: "ログファイル", re: /\.log$/ },
];

export const SECRET_CONTENT_PATTERNS: Pattern[] = [
  { name: "アクセスキー ID", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "シークレットキーらしき代入", re: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/i },
  { name: "秘密鍵ヘッダー", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { name: "JWT らしきトークン", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  {
    name: "パスワード・API キーらしき代入",
    re: /(?:secret|api[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
  },
];

// 環境固有の値の実値。秘密情報ではないが、履歴に載ると消しにくい。
// 値は .env やプレースホルダー(<...> や xxx)で扱う。
export const ENV_INFO_PATTERNS: Pattern[] = [
  { name: "プロファイル名の実値", re: /\bAWS_PROFILE=(?!<|\$|xxx|your|example|\.\.\.)[A-Za-z0-9_.-]+/i },
  // ドキュメントの例示用 ID(123456789012)と、EXAMPLE を含むゾーン ID は、実値ではないので止めない。
  {
    name: "アカウント ID",
    re: /(?:account[=:]\s*['"]?|arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:)(?!123456789012\b)\d{12}\b/i,
  },
  { name: "ホストゾーン ID", re: /\bZ(?!\w*EXAMPLE)(?=[0-9A-Z]*\d)[0-9A-Z]{12,31}\b/ },
  // x だけの並びと example を含む値は、プレースホルダーなので止めない。
  {
    name: "Cognito のユーザープール ID",
    re: /\b[a-z]{2}(?:-[a-z]+)+-\d_(?!x{9}\b)(?!\w*example)[A-Za-z0-9]{9}\b/i,
  },
  // クライアント ID は ID の形だけでは他の文字列と区別できないので、名前つきの代入で見る。
  {
    name: "Cognito のクライアント ID",
    re: /\w*client[_-]?id\w*\s*[:=]\s*['"]?(?!<|\$|x{3}|your|example|\.\.\.)[a-z0-9]{20,}\b/i,
  },
  {
    name: "配信のドメイン",
    re: /\b(?!x+\.)(?!\w*example)(?!d111111abcdef8\.)[a-z0-9]{8,}\.cloudfront\.net\b/i,
  },
  {
    name: "Lambda の Function URL",
    re: /\b(?!x+\.)(?!\w*example)[a-z0-9]{20,}\.lambda-url\.[a-z0-9-]+\.on\.aws\b/i,
  },
];

// 個人情報。ユーザー名を含むパスは、履歴に載ると消しにくいので止める。<ユーザー名> などのプレースホルダーは通す。
export const PII_CONTENT_PATTERNS: Pattern[] = [
  {
    name: "ローカルのユーザーディレクトリのパス",
    re: /\/Users\/(?!(?:example|user|username|you|name|xxx+)\b)[A-Za-z0-9_.-]+/,
  },
];

// コミットメッセージと PR・Issue の下書きだけに適用する。作業の会話や内部メモへの言及と、セッションへのリンク(履歴や本文に載ると消しにくい)。
export const MESSAGE_PHRASE_PATTERNS: Pattern[] = [
  { name: "作業の指示・会話への言及", re: /(ユーザー|人)の指示(で|により|に従)|指示により|会話の(中|なか)で/ },
  { name: "Claude のセッションへのリンク", re: /https?:\/\/claude\.ai\/code\/session_\w+/i },
  { name: "内部メモ", re: /\b(TODO|FIXME|XXX)\b.*(メモ|あとで|後で)|作業メモ/ },
];

// メールアドレスの検査で通す宛先。GitHub の noreply、予約済みのドメイン(example.com など)、ssh の git@github.com。
const ALLOWED_EMAIL =
  /^(?:[^@]+@users\.noreply\.github\.com|noreply@github\.com|git@github\.com|[^@]+@(?:[a-z0-9-]+\.)*(?:example\.(?:com|net|org)|[a-z0-9-]+\.(?:example|test|invalid|localhost)|(?:example|test|invalid|localhost)))$/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// user@host や user:pass@host の形の URL は、メールアドレスではない。
const URL_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@/gi;
// 署名の行(Co-Authored-By: 名前 <noreply@…>)の宛先は、定型として通す。文書やテストが例として引用する場合もある。
const SIGNATURE_LINE = /Co-Authored-By:[^<]*<noreply@[a-z0-9.-]+>/i;

function scanEmails(entries: AddedLine[]): string[] {
  const hits: string[] = [];
  for (const { file, line, text } of entries) {
    if (SIGNATURE_LINE.test(text)) continue;
    const found = text.replace(URL_CREDENTIALS, "").match(EMAIL) ?? [];
    if (found.some((address) => !ALLOWED_EMAIL.test(address)))
      hits.push(`許可されていないメールアドレス: ${file}:${line}`);
  }
  return hits;
}

const NOREPLY = /@users\.noreply\.github\.com$/;
// GitHub 上でマージしたときに、GitHub が作るマージコミットのコミッター(作者ではなく、コミッターにだけ認める)
const GITHUB_WEB_COMMITTER = "noreply@github.com";

/**
 * `git diff -U0` などの unified diff から、追加行を { file, line, text } で取り出す。
 * `+++ ` や `--- ` で始まる行は、ハンクの外(ファイルの見出し)にあるときだけ見出しとして扱う。
 * ハンクの中の `+++ …` は、内容が `++ …` の追加行なので、追加行として検査する。
 */
export function parseAddedLines(diffText: string): AddedLine[] {
  const entries: AddedLine[] = [];
  let file: string | null = null;
  let line = 0;
  let inHunk = false;
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      inHunk = false;
      file = null;
    } else if (!inHunk && raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.replace(/^\+\+\+ "?[a-z]\//, "").replace(/"$/, "");
    } else if (!inHunk && raw.startsWith("--- ")) {
      // 見出し。何もしない
    } else if (raw.startsWith("@@")) {
      inHunk = true;
      const m = raw.match(/\+(\d+)/);
      line = m ? Number(m[1]) : 0;
    } else if (inHunk && raw.startsWith("+") && file) {
      entries.push({ file, line, text: raw.slice(1) });
      line++;
    } else if (inHunk && raw.startsWith(" ") && file) {
      line++;
    }
  }
  return entries;
}

/** 任意のテキスト(メッセージ・下書き)の全行を、追加行として扱う。 */
export function textToEntries(text: string, label: string): AddedLine[] {
  return text.split("\n").map((t, i) => ({ file: label, line: i + 1, text: t }));
}

function scan(entries: AddedLine[], patterns: Pattern[]): string[] {
  const hits: string[] = [];
  for (const { file, line, text } of entries) {
    for (const { name, re } of patterns) {
      if (re.test(text)) hits.push(`${name}: ${file}:${line}`);
    }
  }
  return hits;
}

function scanDenylist(entries: AddedLine[], denylistTerms: string[]): string[] {
  const hits: string[] = [];
  for (const { file, line, text } of entries) {
    const lower = text.toLowerCase();
    // 語も、それを含む行も出さない。何番目の語に当たったかだけ示す。
    denylistTerms.forEach((term, i) => {
      if (lower.includes(term.toLowerCase())) hits.push(`拒否リストの ${i + 1} 番目の語: ${file}:${line}`);
    });
  }
  return hits;
}

/** 差分に含まれるファイル名から、混入させるべきでないファイルを検出する(止める)。 */
export function checkSensitiveFilenames(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    for (const p of SENSITIVE_FILENAME_PATTERNS) {
      if (p.re.test(file) && !p.allow?.test(file)) hits.push(`${p.name}らしきファイル: ${file}`);
    }
  }
  return hits;
}

/** 変更範囲の検査: 成果物ではないパスが混ざっていないか(止める)。 */
export function checkUnexpectedPaths(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    for (const p of UNEXPECTED_PATH_PATTERNS) {
      if (p.re.test(file)) hits.push(`${p.name}が変更に含まれている: ${file}`);
    }
  }
  return hits;
}

/**
 * 一次情報の本文らしい長い文章の検査の対象。台帳などのデータ形式のファイルだけを見る。
 * ソースコード・文書(.ts / .md)と data/ には、長い日本語の文が普通にあるので、対象にしない。
 */
export const PROSE_SCOPE = /^packages\/pipeline\/.+\.(json|jsonl|ndjson|ya?ml|txt|html?|xml|csv|tsv)$/i;
/** 1 行の文章(キーと引用符を除く)の長さの上限。台帳の「言い換え」の上限より大きく、本文の段落より小さい値 */
export const PROSE_LINE_LIMIT = 240;
/** 英文の語数の上限(1 行) */
export const PROSE_WORD_LIMIT = 40;
/** 折り返された本文を捉える。この長さ以上の文章の行が、この数だけ続いたら止める */
export const PROSE_WRAPPED_LINE = 60;
export const PROSE_WRAPPED_RUN = 4;

function proseOf(text: string): string {
  // JSON の「"キー": "値"」の値だけを見る。16 進のハッシュや URL などは、文章としては数えない
  const value = text
    .trim()
    .replace(/^"[^"]*"\s*:\s*/, "")
    .replace(/^"/, "")
    .replace(/,$/, "")
    .replace(/"$/, "");
  return /^[0-9a-fA-F]{32,}$/.test(value) || /^https?:\/\/[\x21-\x7e]+$/.test(value) ? "" : value;
}

/** 台帳などに、出典の本文らしい長い文章が入っていないか(止める)。報告は場所と種類だけで、本文は出さない。 */
export function checkProseBodies(entries: AddedLine[]): string[] {
  const hits: string[] = [];
  const runs = new Map<string, { start: number; count: number; reported: boolean }>();
  for (const { file, line, text } of entries) {
    if (!PROSE_SCOPE.test(file)) continue;
    const prose = proseOf(text);
    const words = prose.split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z'-]*[.,;:]?$/.test(w)).length;
    if (prose.length > PROSE_LINE_LIMIT || words >= PROSE_WORD_LIMIT) {
      hits.push(`本文らしい長い文章: ${file}:${line}`);
    }
    const run = runs.get(file);
    const continues = prose.length >= PROSE_WRAPPED_LINE && run !== undefined && run.start + run.count === line;
    if (prose.length < PROSE_WRAPPED_LINE) {
      runs.delete(file);
    } else if (continues) {
      run.count++;
      if (run.count >= PROSE_WRAPPED_RUN && !run.reported) {
        run.reported = true;
        hits.push(`本文らしい折り返された文章: ${file}:${run.start}`);
      }
    } else {
      runs.set(file, { start: line, count: 1, reported: false });
    }
  }
  return hits;
}

/** 追加行を検査する。blocks は止める対象、warns は人に見せる対象。 */
export function checkEntries(
  entries: AddedLine[],
  denylistTerms: string[] = [],
  { message = false }: { message?: boolean } = {},
): CheckResult {
  const blocks = [
    ...scan(entries, SECRET_CONTENT_PATTERNS),
    ...scan(entries, ENV_INFO_PATTERNS),
    ...scanEmails(entries),
    ...scanDenylist(entries, denylistTerms),
    ...checkProseBodies(entries),
    ...(message ? scan(entries, MESSAGE_PHRASE_PATTERNS) : []),
  ];
  return { blocks: [...new Set([...blocks, ...scan(entries, PII_CONTENT_PATTERNS)])], warns: [] };
}

/** 作者とコミッターのメールアドレスが、GitHub の noreply アドレスか(コミッターは、GitHub 上のマージも認める)。 */
export function checkAuthors(entries: CommitAuthor[]): string[] {
  const hits: string[] = [];
  for (const { sha, authorEmail, committerEmail } of entries) {
    if (!NOREPLY.test(authorEmail)) hits.push(`noreply ではない作者アドレス: コミット ${sha}`);
    if (!NOREPLY.test(committerEmail) && committerEmail !== GITHUB_WEB_COMMITTER)
      hits.push(`noreply ではないコミッターアドレス: コミット ${sha}`);
  }
  return hits;
}

/** 拒否リストのテキスト(1 行 1 語、# 始まりはコメント、空行は無視)を語の配列にする。 */
export function parseDenylist(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}
