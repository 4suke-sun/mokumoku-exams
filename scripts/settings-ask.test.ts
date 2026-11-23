import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `.claude/settings.json` の ask の形を、`*` だけをワイルドカードとして、コマンド全体に照合する
// (Claude Code が複合コマンドを分けて照合する動作は、ここでは再現しない)
const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8")) as {
  permissions: { ask: string[] };
};
const patterns = settings.permissions.ask.map((rule) => {
  const body = /^Bash\((.*)\)$/s.exec(rule)?.[1] ?? "";
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "s");
});
const asks = (command: string): boolean => patterns.some((re) => re.test(command));

describe("settings.json の ask(外に出す操作と、消す・移す操作)", () => {
  it("外に出す操作と、消す・移す操作_確認が出る", () => {
    for (const command of [
      "git push origin main",
      "git -C ../x push",
      "gh pr create --base main",
      "gh pr edit 1 --title x",
      "gh pr merge 1",
      "gh pr close 1",
      "gh pr review 1 --approve",
      "gh pr comment 1 --body x",
      "gh issue create --title x",
      "gh issue close 1",
      "gh issue reopen 1",
      "gh issue delete 1 --yes",
      "gh issue transfer 1 owner/other",
      "gh release create v1.0.0",
      "gh label create bug",
      "cdkd deploy",
      "npm run deploy",
      "cdkd destroy",
      "npm run destroy",
      "npm run release",
      "node scripts/release.ts",
      "node scripts/post-issues.ts .drafts/issues/manifest-x.json",
    ]) {
      expect(asks(command), command).toBe(true);
    }
  });

  it("ラッパーの後ろの呼び出し_先頭に何があっても確認が出る", () => {
    for (const command of [
      "env gh issue close 1",
      "xargs -n1 gh pr comment",
      'bash -c "gh release create v1"',
      "FOO=1 gh issue delete 1",
      "sudo gh issue transfer 1 owner/other",
    ]) {
      expect(asks(command), command).toBe(true);
    }
  });

  it("読むだけの操作_確認が出ない", () => {
    for (const command of [
      "gh release view v1.0.0",
      "gh release list",
      "gh pr view 1 --comments",
      "gh pr list",
      "gh pr diff 1",
      "gh pr checks 1",
      "gh issue view 1",
      "gh issue list --state all",
      "gh label list",
      "gh api repos/o/r/milestones",
      "git status",
      "git log --oneline",
      "git diff origin/main",
      "npm run lint",
      "npm run status",
    ]) {
      expect(asks(command), command).toBe(false);
    }
  });

  it("Issue のコメント_確認が出ない(PR のコメントとは扱いを分ける)", () => {
    expect(asks("gh issue comment 1 --body x")).toBe(false);
  });

  it("ask のすべての形_Bash の形で、先頭が * である", () => {
    for (const rule of settings.permissions.ask) {
      expect(rule, rule).toMatch(/^Bash\(\*/);
    }
  });
});
