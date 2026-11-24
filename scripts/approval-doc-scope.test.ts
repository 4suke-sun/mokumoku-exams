import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyCommand, HEAD_MOVING } from "./lib/approval.ts";

// 承認フックが「承認があっても止める」と文書に書いた形を、同じ表で実装と突き合わせる。
// 文書の側の文言(docText)が変わるとこの表が落ちるので、文書と実装の両方を見直す。
const doc = readFileSync(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");

interface ForbiddenForm {
  docText: string;
  commands: string[];
}

const FORBIDDEN_FORMS: ForbiddenForm[] = [
  {
    docText: "強制 push(`--force…`、`-f`、`+<ref>`)",
    commands: [
      "git push --force origin x",
      "git push --force-with-lease origin x",
      "git push -f origin x",
      "git push -uf origin x",
      "git push origin x -f",
      "git push origin +x",
      "git push origin '+x'",
    ],
  },
  {
    docText: "`git commit` の `-n`・`--no-verify`",
    commands: ["git commit -n -m x", "git commit -nm x", "git commit -m x -n", "git commit --no-verify -m x"],
  },
  {
    docText: "ブランチの削除(`--delete`、`-d`、`:<ref>`。`-ud` のようにほかの短いオプションと束ねた形を含む)",
    commands: [
      "git push --delete origin x",
      "git push origin --delete x",
      "git push -d origin x",
      "git push -ud origin x",
      "git push -qd origin x",
      "git push origin :x",
      "git push origin :refs/heads/x",
    ],
  },
  {
    docText: "`--all`・`--mirror`・`--prune`",
    commands: ["git push --all", "git push --mirror", "git push origin --prune"],
  },
  {
    docText: "タグの push(`refs/tags/…`(`<送り元>:refs/tags/…` を含む)、`--tags`、`--follow-tags`)",
    commands: [
      "git push origin refs/tags/v1",
      "git push origin HEAD:refs/tags/v1",
      "git push --tags",
      "git push --follow-tags",
    ],
  },
];

// 止める形を、区切り・ラッパー・引用符の境界を変えて書いたもの。文書の「見るコマンド」の節が拾うと書く形
const WRAPPED_FORMS = [
  "echo x; git push -f origin x",
  "npm test && git push -f origin x",
  "if true; then git push -f origin x; fi",
  "echo $(git push -f origin x)",
  "env GIT_TRACE=1 git push -f origin x",
  "sudo git push -f origin x",
  "nohup git push -f origin x &",
  "xargs -n1 git push -f",
  "git 'push' -f origin x",
  "/usr/bin/git push -f origin x",
  'bash -c "git push -f origin x"',
  "FOO=1 git push -f origin x",
  "time git push -f origin x",
  "timeout 5 git push -f origin x",
  "nice git push -f origin x",
  "caffeinate git push -f origin x",
  "setsid git push -f origin x",
  "exec git push -f origin x",
  "command git push -f origin x",
  "builtin git push -f origin x",
];

// 承認の印があっても通さない gh の形と、cd と同じコマンドにある操作
const GH_AND_CD_FORMS = [
  "gh pr create --template t.md --body-file .drafts/a.md",
  "gh pr create -T t.md --body-file .drafts/a.md",
  "gh pr edit 1 --recover x --body-file .drafts/a.md",
  "gh pr create --head x --body-file .drafts/a.md",
  "gh pr create -H x --body-file .drafts/a.md",
  "cd x && git push origin y",
  "pushd x; gh pr create --body-file .drafts/a.md",
  "if true; then cd x; git push origin y; fi",
  "cd x; git push origin y",
  "(cd x && git push origin y)",
  'bash -c "cd x && git push origin y"',
  "for i in 1; do cd x; git push origin y; done",
  "if false; then true; else cd x; git push origin y; fi",
  "if false; then true; elif true; then cd x; git push origin y; fi",
  "while cd x; do git push origin y; done",
  "until cd x; do git push origin y; done",
  "command cd x && git push origin y",
  "builtin cd x && git push origin y",
  "time cd x && git push origin y",
  "exec cd x && git push origin y",
  "if cd x; then git push origin y; fi",
  "echo x; cd y; git push origin z",
  "echo x & cd y && git push origin z",
  "echo x | cd y && git push origin z",
  "echo x\ncd y && git push origin z",
  "{ cd x; git push origin y; }",
  "! cd x && git push origin y",
  "echo 'a'; cd x && git push origin y",
  'echo "a" && cd x && git push origin y',
  "git -C ../x push origin y",
  "git --git-dir=x push origin y",
  "git --work-tree=x push origin y",
  "git commit -m x && gh pr create --body-file .drafts/a.md",
  "git switch x && gh issue create --body-file .drafts/a.md",
];

// 承認の印を要する gh の形(作成の別名 new と、-R を先に置いた形)
const GH_GATE_FORMS = ["gh pr new --body-file .drafts/a.md", "gh -R owner/repo pr create --body-file .drafts/a.md"];

describe("承認フックの止める形の文書と実装", () => {
  for (const { docText, commands } of FORBIDDEN_FORMS) {
    it(`文書に書いた止める形_${docText.slice(0, 20)}…を、実装がすべて承認があっても通さない操作にする`, () => {
      expect(doc).toContain(docText);
      for (const command of commands) {
        expect(classifyCommand(command).forbidden.length, command).toBeGreaterThan(0);
      }
    });
  }

  it("区切り・ラッパー・引用符を変えた強制 push_すべて通さない操作にする", () => {
    expect(doc).toContain("`git 'push'` も拾います");
    expect(doc).toContain(
      "ラッパー(`env`、`sudo`、`nohup`、`xargs`、`time`、`timeout`、`nice`、`caffeinate`、`setsid`、`exec`、`command`、`builtin`)",
    );
    for (const command of WRAPPED_FORMS) {
      expect(classifyCommand(command).forbidden.length, command).toBeGreaterThan(0);
    }
  });

  it("本文の出どころと PR のヘッドを変える gh の形と、cd と同じコマンドの操作_すべて通さない操作にする", () => {
    expect(doc).toContain("本文の出どころや PR のヘッドを変える `gh` のオプション");
    expect(doc).toContain("`cd`・`pushd` と同じコマンドにある push、PR・Issue の操作");
    expect(doc).toContain(
      "`cd` は、コマンドの先頭、区切り・括弧・引用符のあと、`then`・`do`・`else`・`elif`・`if`・`while`・`until`・`command`・`builtin`・`time`・`exec` のあとにあるものを見ます",
    );
    for (const command of GH_AND_CD_FORMS) {
      expect(classifyCommand(command).forbidden.length, command).toBeGreaterThan(0);
    }
  });

  it("gh の new(create の別名)と -R を先に置いた形_承認が要る操作として拾う", () => {
    expect(doc).toContain("`gh` の `create` の別名 `new` も、作成として見ます");
    expect(doc).toContain("`gh` は `-R <リポジトリ>` を飛ばして");
    for (const command of GH_GATE_FORMS) {
      expect(classifyCommand(command).gates.length, command).toBeGreaterThan(0);
    }
  });

  it("HEAD やブランチを変える git の操作_文書の一覧と実装の一覧が一致する", () => {
    const line = doc.split("\n").find((l) => l.startsWith("    - `commit`・`switch`"));
    expect(line).toBeDefined();
    const names = [...((line ?? "").split("と、push", 1)[0]?.matchAll(/`([a-z-]+)`/g) ?? [])].map((m) => m[1]);
    expect(new Set(names)).toEqual(HEAD_MOVING);
    for (const name of HEAD_MOVING) {
      expect(classifyCommand(`git ${name} x`).movesHead, name).toBe(true);
    }
  });

  it("push と別のコマンドを同じ行に置く形_HEAD を変える操作と一緒なら通さない操作にする", () => {
    for (const name of HEAD_MOVING) {
      expect(classifyCommand(`git ${name} x && git push origin y`).forbidden.length, name).toBeGreaterThan(0);
    }
  });

  it("push の送り先と無関係な短いオプションの束_強制と取り違えない", () => {
    expect(classifyCommand("git push -u origin x").forbidden).toEqual([]);
    expect(classifyCommand("git push -q origin x").forbidden).toEqual([]);
  });
});
