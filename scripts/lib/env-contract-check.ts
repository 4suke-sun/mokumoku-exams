/**
 * アプリが読む環境変数と、CDK が Lambda へ渡す環境変数の対応の検査。
 * アプリのソース(packages/app)と、スタックのソース(packages/infra/lib)を、文字列として静的に走査する
 * (どちらのワークスペースの内部も import しない)。純粋な関数にして単体テストする。
 * 報告は場所(ファイル:行)と変数の名前だけ。値は扱わない。
 * 読み取れない書き方(検査の限界): `env[変数]` のような動的な参照、`const e = process.env` のような別名への代入、
 * `env` 以外の名前の引数、2 文字以下の名前(`TZ` など)。コメントの中の `env.NAME` も数える。
 * 渡す側は、Web の Lambda の `environment` だけを見る(通知の送信の Lambda は対象にしない)。
 */

export interface Source {
  file: string;
  text: string;
}

export interface EnvRead {
  name: string;
  file: string;
  line: number;
}

/** Lambda が自動で与える変数。CDK で渡さなくてよい。 */
export const LAMBDA_PROVIDED = ["AWS_REGION"];

/** アプリが読むが、CDK で渡さなくてよい変数と、その理由。一覧にあるものだけが除かれる。 */
export const OPTIONAL: Record<string, string> = {
  AUTH_FAKE: "開発用の代替の認証。NODE_ENV が production のときは読まない",
};

const NAME = "[A-Z][A-Z0-9_]{2,}";
// process.env.NAME / env.NAME / env["NAME"] / process.env["NAME"]
const DOT = new RegExp(String.raw`(?:process\.env|\benv)\.(${NAME})\b`, "g");
const BRACKET = new RegExp(String.raw`(?:process\.env|\benv)\[\s*["'](${NAME})["']\s*\]`, "g");
// const { NAME: alias, OTHER } = env / process.env
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*(?:process\.env|env)\b/g;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

export function extractAppEnvReads(sources: Source[]): EnvRead[] {
  const reads: EnvRead[] = [];
  for (const { file, text } of sources) {
    for (const re of [DOT, BRACKET]) {
      for (const m of text.matchAll(re)) reads.push({ name: m[1] as string, file, line: lineOf(text, m.index) });
    }
    for (const m of text.matchAll(DESTRUCTURE)) {
      for (const part of (m[1] as string).split(",")) {
        const name = part.trim().match(new RegExp(`^(${NAME})\\s*(?::|=|$)`))?.[1];
        if (name) reads.push({ name, file, line: lineOf(text, m.index) });
      }
    }
  }
  return reads;
}

/** `{` から対応する `}` までの本文を返す(文字列やコメントの中の括弧は数えない簡易版)。 */
function blockAfter(text: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(openIndex, i + 1);
  }
  return text.slice(openIndex);
}

function keysOf(block: string): string[] {
  return [...block.matchAll(new RegExp(String.raw`\b(${NAME})\s*:`, "g"))].map((m) => m[1] as string);
}

/**
 * アプリの Lambda に渡す `environment: { … }` の名前を集める。ブロックの中で呼ぶ関数(`関数名(`)のうち、
 * 与えられたソースの中に定義があるものは、その関数の本文からも、名前を集める。
 */
export function extractCdkEnvNames(webStack: Source, others: Source[]): Set<string> {
  const names = new Set<string>();
  const start = webStack.text.search(/\benvironment:\s*\{/);
  if (start < 0) return names;
  const block = blockAfter(webStack.text, webStack.text.indexOf("{", start));
  for (const key of keysOf(block)) names.add(key);
  for (const call of block.matchAll(/\b(\w+)\(/g)) {
    for (const { text } of [webStack, ...others]) {
      const fn = text.search(new RegExp(String.raw`function\s+${call[1]}\s*\(`));
      if (fn < 0) continue;
      const open = text.indexOf("{", text.indexOf(")", fn));
      for (const key of keysOf(blockAfter(text, open))) names.add(key);
    }
  }
  return names;
}

export function checkEnvContract(reads: EnvRead[], passed: Set<string>): string[] {
  const errors: string[] = [];
  const exempt = new Set([...LAMBDA_PROVIDED, ...Object.keys(OPTIONAL)]);
  const seen = new Set<string>();
  for (const { name, file, line } of reads) {
    seen.add(name);
    if (!passed.has(name) && !exempt.has(name)) {
      errors.push(`${file}:${line}: アプリが読む環境変数 ${name} が、CDK から Lambda へ渡されない`);
    }
  }
  for (const name of exempt) {
    if (!seen.has(name)) errors.push(`除外の一覧にある ${name} を、アプリが読まない(一覧から消す)`);
  }
  return errors;
}
