/**
 * packages/pipeline が他のワークスペースの内部に依存していないかの検査。
 * 共有してよいのは、データの契約のパッケージ(@mokumoku-exams/data-schema)だけ。
 * 報告は場所(ファイルと行)と種類だけにし、import の文字列そのものは載せない。
 */
import { posix } from "node:path";

export const PIPELINE_ROOT = "packages/pipeline";
const SHARED_PACKAGES: readonly string[] = ["@mokumoku-exams/data-schema"];

export type ViolationKind =
  | "アプリの内部への相対参照"
  | "パッケージの外への相対参照"
  | "他のワークスペースのパッケージの参照"
  | "アプリのパスの別名の参照"
  | "リポジトリ内のパスの直接参照";

export interface Violation {
  file: string;
  line: number;
  kind: ViolationKind;
}

// import / export ... from "x"、import "x"、import("x")、require("x")、require.resolve("x")、new URL("x", ...)。
// 文字列が次の行にあっても拾えるよう、ファイル全体に当てる
const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire(?:\.resolve)?\s*\(\s*|\bnew\s+URL\s*\(\s*)(["'`])([^"'`\n]+)\1/g;

function classify(file: string, specifier: string): ViolationKind | null {
  if (specifier.startsWith(".")) {
    const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
    if (resolved === "packages/app" || resolved.startsWith("packages/app/")) return "アプリの内部への相対参照";
    if (resolved !== PIPELINE_ROOT && !resolved.startsWith(`${PIPELINE_ROOT}/`)) return "パッケージの外への相対参照";
    return null;
  }
  if (specifier.startsWith("@/")) return "アプリのパスの別名の参照";
  if (specifier.startsWith("/") || /^(packages|scripts|data|docs)\//.test(specifier))
    return "リポジトリ内のパスの直接参照";
  if (specifier.startsWith("@mokumoku-exams/")) {
    const name = specifier.split("/").slice(0, 2).join("/");
    return SHARED_PACKAGES.includes(name) ? null : "他のワークスペースのパッケージの参照";
  }
  return null;
}

export function checkPipelineBoundary(files: { path: string; text: string }[]): Violation[] {
  const violations: Violation[] = [];
  for (const { path, text } of files) {
    for (const match of text.matchAll(SPECIFIER)) {
      const kind = classify(path, match[2] ?? "");
      if (kind === null) continue;
      const line = text.slice(0, match.index).split("\n").length;
      violations.push({ file: path, line, kind });
    }
  }
  return violations;
}
