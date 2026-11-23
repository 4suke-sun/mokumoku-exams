import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideHook } from "./approval.ts";
import { decideSubagentCommand, READONLY_ALLOWED_COMMANDS, READONLY_ROLES } from "./subagent-command.ts";

const ok = (agentType: string | undefined, command: string) => decideSubagentCommand(agentType, command).ok;

describe("decideSubagentCommand(読み取り役の区切りと展開)", () => {
  it("単独の&_止める", () => {
    expect(ok("Explore", "git status & rm a")).toBe(false);
    expect(ok("Plan", "git log &")).toBe(false);
  });

  it("括弧_止める", () => {
    expect(ok("Explore", "(git status)")).toBe(false);
    expect(ok("Plan", "git log (x)")).toBe(false);
  });

  it("引用符の外の変数の展開_止める", () => {
    expect(ok("Explore", "cat $HOME/a.md")).toBe(false);
    expect(ok("Plan", `git show \${REF}`)).toBe(false);
  });

  it("引用符の外の#から始まる語_コメントとして止める", () => {
    expect(ok("Explore", "cat a.md #")).toBe(false);
    expect(ok("Plan", "git log #x")).toBe(false);
  });

  it("語の途中や引用符の中の#_止めない", () => {
    expect(ok("Explore", "grep -n a#b docs/a.md")).toBe(true);
    expect(ok("Explore", "grep -n '#' docs/a.md")).toBe(true);
  });

  it("引用符の外の波括弧_展開で--outputを字面からずらす形も止める", () => {
    expect(ok("Plan", "git diff --{output,stat}=x.patch")).toBe(false);
    expect(ok("Plan", "git diff {--output=x.patch,--stat}")).toBe(false);
    expect(ok("Explore", "ls {a,b}")).toBe(false);
  });

  it("引用符の中の波括弧_通す", () => {
    expect(ok("Explore", "grep -n '{a,b}' docs/a.md")).toBe(true);
    expect(ok("Explore", 'grep -n "}" docs/a.md')).toBe(true);
  });

  it("ドル記号の付いた単一引用符_止める", () => {
    expect(ok("Explore", "grep $'a\\nb' docs/a.md")).toBe(false);
  });

  it("ヒアドキュメントとヒアストリング_止める", () => {
    expect(ok("Explore", "cat <<EOF")).toBe(false);
    expect(ok("Explore", "grep a <<< b")).toBe(false);
  });

  it("改行と行の継続と末尾のバックスラッシュ_1行だけ通すので止める", () => {
    for (const command of ["git log\nrm a", "git log \\\n--oneline", "git log\r", "git log \\"]) {
      expect(ok("Plan", command), JSON.stringify(command)).toBe(false);
    }
  });
});

describe("decideSubagentCommand(読み取り役の引用符の取り違え)", () => {
  it("二重引用符の中の単一引用符のあとに演算子がある_止める", () => {
    expect(ok("Explore", `grep "it's" a.md; rm -f b`)).toBe(false);
    expect(ok("Explore", `grep "it's" a.md | sh`)).toBe(false);
  });

  it("引用符の外のバックスラッシュで打ち消した引用符のあとに演算子がある_止める", () => {
    expect(ok("Explore", "grep \\' a.md; rm -f b")).toBe(false);
    expect(ok("Explore", 'grep \\" a.md | sh')).toBe(false);
  });

  it("閉じない引用符や二重引用符の中の変数_止める", () => {
    expect(ok("Explore", 'grep "abc a.md')).toBe(false);
    expect(ok("Explore", "grep 'abc a.md")).toBe(false);
    expect(ok("Explore", 'grep "$HOME" a.md')).toBe(false);
    expect(ok("Explore", 'grep "$(rm a)" a.md')).toBe(false);
  });

  it("引用符の中の演算子の文字_通す", () => {
    expect(ok("Explore", `grep -n 'a; b | c > d' docs/a.md`)).toBe(true);
    expect(ok("Explore", `grep -n "it's a > b" docs/a.md`)).toBe(true);
  });
});

describe("decideSubagentCommand(ほかの役)", () => {
  it("役の名前がない_止めない", () => {
    expect(ok(undefined, "rm -rf tmp")).toBe(true);
    expect(ok("", "echo x > a")).toBe(true);
  });

  it("読み取り役でない役_この判定では止めない", () => {
    expect(ok("general-purpose", "npm test > out.txt")).toBe(true);
    expect(ok("question-drafter", "echo x > a")).toBe(true);
  });
});

describe("decideSubagentCommand(読み取り役)", () => {
  for (const role of READONLY_ROLES) {
    it(`${role} の許可のコマンド_通す`, () => {
      expect(ok(role, "cat docs/a.md")).toBe(true);
      expect(ok(role, "head -n 20 docs/a.md")).toBe(true);
      expect(ok(role, "grep -rn 'foo bar' packages/app")).toBe(true);
      expect(ok(role, "ls -la scripts")).toBe(true);
      expect(ok(role, "wc -l scripts/lib/approval.ts")).toBe(true);
      expect(ok(role, "git log --oneline -5")).toBe(true);
      expect(ok(role, "git diff origin/main..HEAD --stat")).toBe(true);
      expect(ok(role, "find packages -name '*.ts' -newer package.json")).toBe(true);
    });
  }

  it("パイプと 2>/dev/null_許可のコマンドどうしなら通す", () => {
    expect(ok("Explore", "git log --oneline | head -n 5")).toBe(true);
    expect(ok("Explore", "grep -rn foo . 2>/dev/null | wc -l")).toBe(true);
    expect(ok("Explore", "ls missing 2>/dev/null")).toBe(true);
    expect(ok("Explore", "cat a.md | grep 'a | b' | head")).toBe(true);
  });

  it("許可の一覧の外のコマンド_止める", () => {
    for (const command of [
      "rm -rf tmp",
      "npm test",
      "node scripts/x.ts",
      "sed -i s/a/b/ f",
      "sort -o out f",
      "awk 1 f",
      "xargs cat",
    ]) {
      expect(ok("Explore", command)).toBe(false);
    }
    expect(ok("Plan", "git push")).toBe(false);
    expect(ok("Plan", "git branch -D x")).toBe(false);
    expect(ok("Plan", "git -C ../x log")).toBe(false);
    expect(ok("Plan", "git -c core.pager=x log")).toBe(false);
  });

  it("ファイルへの書き出し_リダイレクトとオプションを止める", () => {
    for (const command of [
      "cat a > b",
      "cat a >> b",
      "cat a 1>b",
      "cat a >&2",
      "cat a &> b",
      "cat a 2>b",
      "cat a 2>>/dev/null",
      "cat a 2>/dev/nullx",
      "echo|tee f",
      "git diff --output=out.patch",
      "git log --output out.txt",
    ]) {
      expect(ok("Explore", command)).toBe(false);
    }
  });

  it("find の書き込み・起動・削除のオプション_ほかの規則に当たらない形でも、find の判定で止める", () => {
    // 波括弧は引用符で包み、`;` はバックスラッシュで打ち消して、字句の規則では止まらない形にし、find のオプションの判定だけを確かめる
    for (const option of [
      "-exec rm '{}' \\;",
      "-execdir cat '{}' \\;",
      "-ok rm '{}' \\;",
      "-okdir rm '{}' \\;",
      "-delete",
      "-fprint out.txt",
      "-fprint0 out",
      "-fprintf out x",
      "-fls out",
    ]) {
      const decision = decideSubagentCommand("Explore", `find . ${option}`);
      expect(decision.ok).toBe(false);
      expect(decision.ok ? "" : decision.reason).toContain("find の書き込み・起動・削除のオプション");
    }
  });

  it("既知のすり抜けの形_止める", () => {
    for (const command of [
      "cat a # > b",
      "cat $'\\x61'",
      "cat <<EOF",
      "cat <<<x",
      "for f in a; do cat $f; done",
      "if true; then cat a; fi",
      "bash -lc 'echo x > a'",
      "$CMD a",
      "$(echo cat) a",
      "cat `echo a`",
      "cat a; rm b",
      "cat a && rm b",
      "cat a || rm b",
      "cat a |& tee b",
      "(cat a)",
      "cat a &",
      "cat a\nrm b",
      "cat {a,b}",
      "cat 'a",
      "cat a\\",
    ]) {
      expect(ok("Explore", command)).toBe(false);
    }
  });

  it("空のコマンドと、パイプの端が空_止める", () => {
    expect(ok("Explore", "")).toBe(false);
    expect(ok("Explore", "| head")).toBe(false);
    expect(ok("Explore", "cat a |")).toBe(false);
  });

  it("引用符の中の演算子の文字と2>/dev/null_引数なので通す", () => {
    expect(ok("Explore", "grep 'a > b' docs/a.md")).toBe(true);
    expect(ok("Explore", 'grep "x; y" docs/a.md')).toBe(true);
    expect(ok("Explore", "grep '2>/dev/null' docs/a.md")).toBe(true);
  });

  it("止めた理由_代わりの手段を添える", () => {
    const decision = decideSubagentCommand("Explore", "cat a > b");
    expect(decision.ok ? "" : decision.reason).toContain("Read、検索は Grep・Glob");
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

  it("読み取り役が許可の外のコマンドを使う_理由を添えて止める", () => {
    const decision = hook("node scripts/check-pr-secrets.ts .drafts/x.md", "Explore");
    expect(decision.ok).toBe(false);
    expect(decision.ok ? "" : decision.reason).toContain("メインのセッションに任せて");
  });

  it("サブエージェントで役の名前がない_役の判定をせず従来の判定に進む", () => {
    expect(hook("echo x > a").ok).toBe(true);
    const push = hook("git push");
    expect(push.ok).toBe(false);
    expect(push.ok ? "" : push.reason).toContain("サブエージェントからは実行しません");
  });

  it("読み取り役が書き込む形を使う_理由を添えて止める", () => {
    const decision = hook("cat <<EOF > a.txt", "Explore");
    expect(decision.ok).toBe(false);
    expect(hook("cat a.txt | head", "Explore").ok).toBe(true);
  });

  it("サブエージェントの識別子がない_読み取り役の名前があっても役の判定をしない", () => {
    expect(hook("echo x > a", "Explore", "").ok).toBe(true);
  });
});

describe("読み取り役の一覧と CONTRIBUTING.md の一致", () => {
  const doc = readFileSync(new URL("../../CONTRIBUTING.md", import.meta.url), "utf8");
  // 「…は、`a`・`b`…だけ」の行の、だけより前のバッククォートの語
  const listed = (marker: string): string[] => {
    const line = doc.split("\n").find((l) => l.includes(marker)) ?? "";
    const part = line.slice(line.indexOf(marker), line.indexOf("だけ", line.indexOf(marker)));
    return [...part.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
  };

  it("読み取り役の名前_コードの一覧と同じものを挙げる", () => {
    expect(listed("読み取り役の名前は").sort()).toEqual([...READONLY_ROLES].sort());
  });

  it("読み取り役が実行してよいコマンド_コードの一覧と同じものを挙げる", () => {
    expect(listed("読み取り役が Bash で実行してよいのは").sort()).toEqual([...READONLY_ALLOWED_COMMANDS].sort());
  });
});
