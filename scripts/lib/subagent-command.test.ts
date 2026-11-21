import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideHook } from "./approval.ts";
import { decideSubagentCommand, WRITER_ALLOWED_COMMANDS } from "./subagent-command.ts";

const ok = (agentType: string | undefined, command: string) => decideSubagentCommand(agentType, command).ok;

describe("decideSubagentCommand(作成役)", () => {
  it("commit-writer の許可のコマンド_通す", () => {
    for (const command of [
      "git diff --cached",
      "git diff --cached --stat",
      "git log --oneline -5",
      "git rev-parse HEAD",
    ]) {
      expect(ok("commit-writer", command)).toBe(true);
    }
  });

  it("commit-writer の許可の外のコマンド_止める", () => {
    for (const command of [
      "grep -n foo README.md",
      "sed -n 1,5p a.md",
      "head a.md",
      "wc -l a.md",
      "node -e 1",
      "cat .drafts/commit-msg.txt",
    ]) {
      expect(ok("commit-writer", command)).toBe(false);
    }
  });

  it("draft-writer の読み取りのコマンド_通す", () => {
    for (const command of ["cat .drafts/x.md", "ls .drafts", 'grep -n "a|b" docs/a.md', "git show HEAD --stat"]) {
      expect(ok("draft-writer", command)).toBe(true);
    }
  });

  it("draft-writer の機械検査のスクリプトや gh_止める", () => {
    for (const command of [
      "node scripts/check-pr-secrets.ts .drafts/x.md",
      "npm run lint",
      "gh issue view 1",
      "python3 -c 1",
    ]) {
      expect(ok("draft-writer", command)).toBe(false);
    }
  });

  it("連結・パイプ・リダイレクト・置換_許可のコマンドでも止める", () => {
    for (const command of [
      "git diff --cached | head",
      "git log; rm -f a",
      "git status && touch a",
      "git diff > .drafts/x.txt",
      "git show $(echo HEAD)",
      "git show `echo HEAD`",
      "git diff 2>/dev/null",
    ]) {
      expect(ok("draft-writer", command), command).toBe(false);
    }
  });

  it("git の別のパスや設定を指す形とファイルへの書き出し_止める", () => {
    for (const command of [
      "git -C /tmp diff",
      "git -c core.pager=x log",
      "git diff --output=x.patch",
      "git diff --output x.patch",
    ]) {
      expect(ok("commit-writer", command)).toBe(false);
    }
  });
});

describe("decideSubagentCommand(作成役の区切りと展開)", () => {
  it("単独の&_止める", () => {
    expect(ok("draft-writer", "git status & rm a")).toBe(false);
    expect(ok("commit-writer", "git log &")).toBe(false);
  });

  it("括弧_止める", () => {
    expect(ok("draft-writer", "(git status)")).toBe(false);
    expect(ok("commit-writer", "git log (x)")).toBe(false);
  });

  it("引用符の外の変数の展開_止める", () => {
    expect(ok("draft-writer", "cat $HOME/a.md")).toBe(false);
    expect(ok("commit-writer", `git show \${REF}`)).toBe(false);
  });

  it("引用符の外の#から始まる語_コメントとして止める", () => {
    expect(ok("draft-writer", "cat a.md #")).toBe(false);
    expect(ok("commit-writer", "git log #x")).toBe(false);
  });

  it("語の途中や引用符の中の#_止めない", () => {
    expect(ok("draft-writer", "grep -n a#b docs/a.md")).toBe(true);
    expect(ok("draft-writer", "grep -n '#' docs/a.md")).toBe(true);
  });

  it("ドル記号の付いた単一引用符_止める", () => {
    expect(ok("draft-writer", "grep $'a\\nb' docs/a.md")).toBe(false);
  });

  it("ヒアドキュメントとヒアストリング_止める", () => {
    expect(ok("draft-writer", "cat <<EOF")).toBe(false);
    expect(ok("draft-writer", "grep a <<< b")).toBe(false);
  });

  it("改行と行の継続と末尾のバックスラッシュ_1行だけ通すので止める", () => {
    for (const command of ["git log\nrm a", "git log \\\n--oneline", "git log\r", "git log \\"]) {
      expect(ok("commit-writer", command), JSON.stringify(command)).toBe(false);
    }
  });
});

describe("decideSubagentCommand(作成役の引用符の取り違え)", () => {
  it("二重引用符の中の単一引用符のあとに演算子がある_止める", () => {
    expect(ok("draft-writer", `grep "it's" a.md; rm -f b`)).toBe(false);
    expect(ok("draft-writer", `grep "it's" a.md | sh`)).toBe(false);
  });

  it("引用符の外のバックスラッシュで打ち消した引用符のあとに演算子がある_止める", () => {
    expect(ok("draft-writer", "grep \\' a.md; rm -f b")).toBe(false);
    expect(ok("draft-writer", 'grep \\" a.md | sh')).toBe(false);
  });

  it("閉じない引用符や二重引用符の中の変数_止める", () => {
    expect(ok("draft-writer", 'grep "abc a.md')).toBe(false);
    expect(ok("draft-writer", "grep 'abc a.md")).toBe(false);
    expect(ok("draft-writer", 'grep "$HOME" a.md')).toBe(false);
    expect(ok("draft-writer", 'grep "$(rm a)" a.md')).toBe(false);
  });

  it("引用符の中の演算子の文字_通す", () => {
    expect(ok("draft-writer", `grep -n 'a; b | c > d' docs/a.md`)).toBe(true);
    expect(ok("draft-writer", `grep -n "it's a > b" docs/a.md`)).toBe(true);
  });
});

describe("decideSubagentCommand(ほかの役)", () => {
  it("役の名前がない_止めない", () => {
    expect(ok(undefined, "rm -rf tmp")).toBe(true);
    expect(ok("", "echo x > a")).toBe(true);
  });

  it("作成役でない役_止めない", () => {
    expect(ok("general-purpose", "npm test > out.txt")).toBe(true);
    expect(ok("Explore", "echo x > a")).toBe(true);
  });
});

describe("decideHook と役ごとの判定", () => {
  const hook = (command: string, agentType?: string, agentId = "a1") =>
    decideHook(
      { tool_name: "Bash", tool_input: { command }, agent_id: agentId, agent_type: agentType },
      () => ({ entries: [] }),
      0,
      () => {
        throw new Error("probe は呼ばない");
      },
    );

  it("作成役が許可の外のコマンドを使う_理由を添えて止める", () => {
    const decision = hook("node scripts/check-pr-secrets.ts .drafts/x.md", "draft-writer");
    expect(decision.ok).toBe(false);
    expect(decision.ok ? "" : decision.reason).toContain("メインのセッションに任せて");
  });

  it("サブエージェントで役の名前がない_役の判定をせず従来の判定に進む", () => {
    expect(hook("echo x > a").ok).toBe(true);
    const push = hook("git push");
    expect(push.ok).toBe(false);
    expect(push.ok ? "" : push.reason).toContain("サブエージェントからは実行しません");
  });

  it("サブエージェントの識別子がない_作成役の名前があっても役の判定をしない", () => {
    expect(hook("echo x > a", "draft-writer", "").ok).toBe(true);
  });
});

describe("作成役の定義と許可の一覧の一致", () => {
  // 定義の「Bash で実行してよいのは、…だけ」の行のコマンドを、許可の一覧と突き合わせる
  const listed = (name: string): string[] => {
    const text = readFileSync(new URL(`../../.claude/agents/${name}.md`, import.meta.url), "utf8");
    const line = text.split("\n").find((l) => l.includes("Bash で実行してよいのは")) ?? "";
    const allowedPart = line.slice(0, line.indexOf("だけ"));
    return [...allowedPart.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
  };

  for (const name of Object.keys(WRITER_ALLOWED_COMMANDS)) {
    it(`${name} の定義_許可の一覧と同じコマンドを挙げる`, () => {
      expect([...listed(name)].sort()).toEqual([...(WRITER_ALLOWED_COMMANDS[name] ?? [])].sort());
    });
  }
});
