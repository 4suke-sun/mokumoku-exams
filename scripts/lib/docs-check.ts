/**
 * 文書(Markdown)の参照の検査。
 *   - 相対リンクの先のファイルが実在する(コードブロックとインラインコードの中は対象にしない)
 *   - 文書が書く `npm run <名前>` のスクリプトが実在する(`-w` / `--workspace` 付きは、そのワークスペースで照合する)
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/check-docs.ts)。報告は場所(ファイル:行)と種類だけ。
 */
import { dirname, join, normalize } from "node:path";

export interface DocFile {
  file: string;
  text: string;
}

export interface ScriptSets {
  /** ルートの package.json のスクリプト名 */
  root: Set<string>;
  /** ワークスペースごとのスクリプト名。キーは、パッケージ名(`@scope/name`)とディレクトリ(`packages/name`)の両方 */
  workspaces: Map<string, Set<string>>;
}

// 検査する文書。`git ls-files` のパス指定で、`*` は `/` をまたぐ(`docs/*.md` は docs の下のすべての階層を含む)。
// `**` は `/` を 1 つ挟む指定になり、docs 直下のファイルが漏れるので使わない。
export const DOC_PATTERNS = [
  "README.md",
  "CLAUDE.md",
  "CONTRIBUTING.md",
  "docs/*.md",
  ".claude/skills/*.md",
  "packages/*/README.md",
];

const FENCE = /^\s*(```|~~~)/;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** コードブロックの中の行を空にして、行番号を保ったまま返す。 */
function blankFences(text: string): string[] {
  let inFence = false;
  return text.split("\n").map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

/** 相対リンクの先(アンカーとクエリを除く)と、その行。外部の URL、`#` だけ、コードの中は対象にしない。 */
export function extractLinks(text: string): { target: string; line: number }[] {
  const found: { target: string; line: number }[] = [];
  blankFences(text).forEach((raw, i) => {
    const line = raw.replace(/`[^`]*`/g, "");
    const targets = [
      ...[...line.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)].map((m) => m[1] as string),
      ...[...line.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/g)].map((m) => m[1] as string),
    ];
    for (const raw of targets) {
      if (EXTERNAL.test(raw)) continue;
      const target = raw.split("#")[0]?.split("?")[0] ?? "";
      if (target !== "") found.push({ target, line: i + 1 });
    }
  });
  return found;
}

export function checkLinks(files: DocFile[], exists: (path: string) => boolean): string[] {
  const errors: string[] = [];
  for (const { file, text } of files) {
    for (const { target, line } of extractLinks(text)) {
      const joined = target.startsWith("/") ? target.slice(1) : normalize(join(dirname(file), target));
      const resolved = joined.replace(/\/$/, "");
      if (!exists(resolved)) errors.push(`${file}:${line}: リンク先のファイルが存在しない`);
    }
  }
  return errors;
}

// `npm run <名前>` と、同じコマンドの中の `-w <ワークスペース>`。コマンドの終わりは、&&・||・;・|・バッククォート・行末
const NPM_RUN = /npm run\s+([^`\n&|;]*)/g;

export function extractNpmRuns(text: string): { name: string; workspace: string | null; line: number }[] {
  const found: { name: string; workspace: string | null; line: number }[] = [];
  text.split("\n").forEach((rawLine, i) => {
    for (const m of rawLine.matchAll(NPM_RUN)) {
      const tokens = (m[1] as string).trim().split(/\s+/);
      let name: string | null = null;
      let workspace: string | null = null;
      for (let t = 0; t < tokens.length; t++) {
        const token = tokens[t] as string;
        if (token === "--") break;
        if (token === "-w" || token === "--workspace") workspace = tokens[++t] ?? null;
        else if (token.startsWith("--workspace=")) workspace = token.slice("--workspace=".length);
        else if (name === null && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(token)) name = token;
      }
      if (name !== null) found.push({ name, workspace, line: i + 1 });
    }
  });
  return found;
}

export function checkNpmRuns(files: DocFile[], scripts: ScriptSets): string[] {
  const errors: string[] = [];
  for (const { file, text } of files) {
    for (const { name, workspace, line } of extractNpmRuns(text)) {
      const set = workspace === null ? scripts.root : scripts.workspaces.get(workspace);
      if (set === undefined) errors.push(`${file}:${line}: npm run のワークスペースが存在しない`);
      else if (!set.has(name)) errors.push(`${file}:${line}: npm run のスクリプトが存在しない`);
    }
  }
  return errors;
}
