#!/usr/bin/env node
/**
 * 人の承認の印を扱う。スキルが、人の承認を得たあとに、メインのセッションから実行する。
 *   node scripts/approval.ts grant push [--base <ref>]
 *   node scripts/approval.ts grant pr <下書き> [--base <ref>]
 *   node scripts/approval.ts grant issue <下書き>
 *   node scripts/approval.ts grant deploy <版>
 *   node scripts/approval.ts status
 *   node scripts/approval.ts revoke
 * deploy の grant は、版のタグのコミット(作業ツリーの先頭と同じであること)と、差分の置き場(.drafts/deploy/diff.masked.txt)のハッシュを覆う。
 * 印は `.git` の下に置く(追跡されない)。止める側は scripts/approval-hook.ts。
 * pr・issue の grant は、下書きの本文(3 行目以降)を `<下書き>.body.md` に書き出し、題と本文のハッシュも印に入れる。
 * コマンド置換・プロセス置換を使わずに投稿するコマンド(題の直書きと、本文のファイル)を表示する。
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  type ApprovalEntry,
  type ApprovalKind,
  approvalPath,
  bodyPathFor,
  DEPLOY_DIFF_PATH,
  grant,
  readApprovals,
  sha256,
  splitDraft,
  TTL_MS,
  UNSAFE_TITLE,
  writeApprovals,
} from "./lib/approval.ts";
import { git } from "./lib/git-check.ts";

const USAGE =
  "使い方: node scripts/approval.ts grant push [--base <ref>] | grant pr <下書き> [--base <ref>] | grant issue <下書き> | grant deploy <版> | status | revoke\n";

const [command, kind, ...rest] = process.argv.slice(2);

function option(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

const now = Date.now();

try {
  const path = approvalPath(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim());
  if (command === "grant" && kind === "deploy") {
    const version = rest[0] ?? "";
    if (!/^v\d+\.\d+\.\d+$/.test(version)) throw new Error("版を vX.Y.Z の形で指定してください");
    const tagCommit = git(["rev-list", "-n", "1", `refs/tags/${version}`]).trim();
    if (tagCommit !== git(["rev-parse", "HEAD"]).trim())
      throw new Error("作業ツリーの先頭が、版のタグのコミットでありません");
    const entry: ApprovalEntry = {
      kind: "deploy",
      branch: version,
      head: tagCommit,
      count: 0,
      base: "",
      draftHash: sha256(readFileSync(DEPLOY_DIFF_PATH)),
      expiresAt: now + TTL_MS,
    };
    writeApprovals(path, grant(readApprovals(path), entry, now));
    process.stdout.write(`承認の印を書きました(deploy ${version}、有効 ${TTL_MS / 60000} 分)\n`);
  } else if (command === "grant" && (kind === "push" || kind === "pr" || kind === "issue")) {
    const draft = rest.find((a) => !a.startsWith("--") && a !== option("--base"));
    if (kind !== "push" && !draft) throw new Error("下書きのファイルを指定してください");
    const draftText = draft ? readFileSync(draft) : null;
    const draftHash = draftText ? sha256(draftText) : "";
    // 題を直書きし、本文を静的なファイルで渡す形のために、本文を書き出し、題と本文のハッシュを印に入れる
    const split = draft && draftText && kind !== "push" ? splitDraft(draftText.toString("utf8"), kind) : null;
    const bodyPath = draft && split ? bodyPathFor(draft) : null;
    if (bodyPath && split) writeFileSync(bodyPath, split.body);
    const texts = split ? { titleHash: sha256(split.title), bodyHash: sha256(split.body) } : {};
    const entry: ApprovalEntry =
      kind === "issue"
        ? { kind, branch: "", head: "", count: 0, base: "", draftHash, ...texts, expiresAt: now + TTL_MS }
        : {
            kind: kind as ApprovalKind,
            branch: git(["branch", "--show-current"]).trim(),
            head: git(["rev-parse", "HEAD"]).trim(),
            count: Number(git(["rev-list", "--count", `${option("--base") ?? "origin/main"}..HEAD`]).trim()),
            base: option("--base") ?? "origin/main",
            draftHash,
            ...texts,
            expiresAt: now + TTL_MS,
          };
    writeApprovals(path, grant(readApprovals(path), entry, now));
    process.stdout.write(`承認の印を書きました(${kind}、有効 ${TTL_MS / 60000} 分)\n`);
    if (split && bodyPath) {
      process.stdout.write(`本文を書き出しました: ${bodyPath}\n`);
      if (split.title === "" || split.title.startsWith("-") || UNSAFE_TITLE.test(split.title)) {
        process.stdout.write(
          '題に、直書きで渡せない文字があります。--title "$(head -n 1 <下書き>)" の形で投稿してください\n',
        );
      } else {
        const create = kind === "pr" ? "gh pr create --base main" : "gh issue create";
        process.stdout.write(
          `投稿のコマンド(置換を使わない形):\n  ${create} --title '${split.title}' --body-file ${bodyPath}\n`,
        );
      }
    }
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
