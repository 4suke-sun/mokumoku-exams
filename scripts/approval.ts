#!/usr/bin/env node
/**
 * 人の承認の印を扱う。スキルが、人の承認を得たあとに、メインのセッションから実行する。
 *   node scripts/approval.ts grant push [--base <ref>]
 *   node scripts/approval.ts grant pr <下書き> [--base <ref>]
 *   node scripts/approval.ts grant issue <下書き>
 *   node scripts/approval.ts status
 *   node scripts/approval.ts revoke
 * 印は `.git` の下に置く(追跡されない)。止める側は scripts/approval-hook.ts。
 */
import { readFileSync } from "node:fs";
import {
  type ApprovalEntry,
  type ApprovalKind,
  approvalPath,
  grant,
  readApprovals,
  sha256,
  TTL_MS,
  writeApprovals,
} from "./lib/approval.ts";
import { git } from "./lib/git-check.ts";

const USAGE =
  "使い方: node scripts/approval.ts grant push [--base <ref>] | grant pr <下書き> [--base <ref>] | grant issue <下書き> | status | revoke\n";

const [command, kind, ...rest] = process.argv.slice(2);

function option(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

const now = Date.now();

try {
  const path = approvalPath(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  if (command === "grant" && (kind === "push" || kind === "pr" || kind === "issue")) {
    const draft = rest.find((a) => !a.startsWith("--") && a !== option("--base"));
    if (kind !== "push" && !draft) throw new Error("下書きのファイルを指定してください");
    const draftHash = draft ? sha256(readFileSync(draft)) : "";
    const entry: ApprovalEntry =
      kind === "issue"
        ? { kind, branch: "", head: "", count: 0, base: "", draftHash, expiresAt: now + TTL_MS }
        : {
            kind: kind as ApprovalKind,
            branch: git(["branch", "--show-current"]).trim(),
            head: git(["rev-parse", "HEAD"]).trim(),
            count: Number(git(["rev-list", "--count", `${option("--base") ?? "origin/main"}..HEAD`]).trim()),
            base: option("--base") ?? "origin/main",
            draftHash,
            expiresAt: now + TTL_MS,
          };
    writeApprovals(path, grant(readApprovals(path), entry, now));
    process.stdout.write(`承認の印を書きました(${kind}、有効 ${TTL_MS / 60000} 分)\n`);
  } else if (command === "status") {
    const live = readApprovals(path).entries.filter((e) => e.expiresAt > now);
    if (live.length === 0) process.stdout.write("有効な承認の印はありません\n");
    for (const e of live) {
      const minutes = Math.round((e.expiresAt - now) / 60000);
      process.stdout.write(`${e.kind} ${e.branch || "-"} 残り ${minutes} 分\n`);
    }
  } else if (command === "revoke") {
    writeApprovals(path, { entries: [] });
    process.stdout.write("承認の印を消しました\n");
  } else {
    process.stderr.write(USAGE);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`承認の印を扱えませんでした: ${(error as Error).message}\n`);
  process.exitCode = 1;
}
