import { describe, expect, it } from "vitest";
import {
  type ApprovalEntry,
  type Approvals,
  bodyPathFor,
  classifyCommand,
  DEPLOY_DIFF_PATH,
  decideHook,
  grant,
  type Probe,
  parseApprovals,
  sha256,
  splitDraft,
  TTL_MS,
} from "./approval.ts";

const NOW = 1_000_000_000_000;
const entry = (over: Partial<ApprovalEntry> = {}): ApprovalEntry => ({
  kind: "pr",
  branch: "chore/#1-v0.1.0",
  head: "aaa",
  count: 3,
  base: "origin/main",
  draftHash: "h1",
  expiresAt: NOW + TTL_MS,
  ...over,
});
const probe = (over: Partial<Probe> = {}): Probe => ({
  branch: "chore/#1-v0.1.0",
  head: "aaa",
  countFrom: () => 3,
  hashOf: () => "h1",
  ...over,
});
const run = (command: string, approvals: Approvals, p: Probe = probe(), agentId?: string) =>
  decideHook(
    { tool_name: "Bash", tool_input: { command }, agent_id: agentId },
    () => approvals,
    NOW,
    () => p,
  );
const none: Approvals = { entries: [] };

describe("classifyCommand", () => {
  it("git push_承認が要る操作として拾う", () => {
    expect(classifyCommand("git push -u origin feat/x").gates).toMatchObject([
      { kind: "push", command: "git push", refspecs: ["feat/x"] },
    ]);
  });

  it("git の全体オプションつきの push_push として拾う", () => {
    expect(classifyCommand("git -C /tmp/x -c a=b push origin HEAD").gates).toHaveLength(1);
  });

  it("複合コマンドの途中の push_拾う", () => {
    expect(classifyCommand("npm test && git push origin x").gates).toHaveLength(1);
    expect(classifyCommand("FOO=1 git push").gates).toHaveLength(1);
  });

  it("gh の pr と issue の作成・編集_種類ごとに拾う", () => {
    expect(classifyCommand("gh pr create --base main").gates[0]?.kind).toBe("pr");
    expect(classifyCommand("gh pr edit 3 --title x").gates[0]?.kind).toBe("pr");
    expect(classifyCommand("gh issue create --title x").gates[0]?.kind).toBe("issue");
  });

  it("env と sudo などのラッパー越しの push_拾う", () => {
    expect(classifyCommand("env GIT_TRACE=1 git push").gates).toHaveLength(1);
    expect(classifyCommand("sudo -u x git push").gates).toHaveLength(1);
    expect(classifyCommand("nohup git push &").gates).toHaveLength(1);
    expect(classifyCommand("xargs -n1 git push").gates).toHaveLength(1);
  });

  it("単独の & と、シェルの予約語・波かっこの後ろの push_拾う", () => {
    expect(classifyCommand("sleep 1 & git push").gates).toHaveLength(1);
    expect(classifyCommand("if true; then git push; fi").gates).toHaveLength(1);
    expect(classifyCommand("for b in x; do git push origin $b; done").gates).toHaveLength(1);
    expect(classifyCommand("{ git push; }").gates).toHaveLength(1);
    expect(classifyCommand("! git push").gates).toHaveLength(1);
  });

  it("送り元つきのタグの push と --follow-tags_通さない操作にする", () => {
    expect(classifyCommand("git push origin HEAD:refs/tags/v1").forbidden).toHaveLength(1);
    expect(classifyCommand("git push --follow-tags").forbidden).toHaveLength(1);
  });

  it("gh の -R を先に置いた形と、bash のオプションを挟んだ -c_拾う", () => {
    expect(classifyCommand("gh -R owner/repo pr create --title x").gates[0]?.kind).toBe("pr");
    expect(classifyCommand("gh pr create -R owner/repo --title x").gates[0]?.kind).toBe("pr");
    expect(classifyCommand('bash --norc -c "git push"').gates).toHaveLength(1);
  });

  it("作業ツリーを指定する push と --prune_通さない操作にする", () => {
    expect(classifyCommand("git -C ../other push").forbidden).toHaveLength(1);
    expect(classifyCommand("git --git-dir=../x/.git push").forbidden).toHaveLength(1);
    expect(classifyCommand("git push --prune origin").forbidden).toHaveLength(1);
  });

  it("本文を直書きする PR と Issue の作成・編集_通さない操作にする", () => {
    expect(classifyCommand('gh pr create --body "x" --body-file .drafts/p.md').forbidden).toHaveLength(1);
    expect(classifyCommand("gh issue edit 3 -b x").forbidden).toHaveLength(1);
    expect(classifyCommand("gh pr create --body=x").forbidden).toHaveLength(1);
    expect(classifyCommand("gh pr create --body-file .drafts/p.md").forbidden).toEqual([]);
  });

  it("値を続けた短いオプションの本文と題_題・本文の編集として拾い、直書きは通さない", () => {
    expect(classifyCommand("gh issue edit 3 -bX").forbidden).toHaveLength(1);
    expect(classifyCommand("gh issue edit 3 -db X").forbidden).toHaveLength(1);
    expect(classifyCommand("gh pr edit 3 -tNew").gates).toHaveLength(1);
    expect(classifyCommand("gh pr edit 3 -t New").gates).toHaveLength(1);
    expect(classifyCommand("gh pr create -F- --title x").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create -Bmain").forbidden).toEqual([]);
  });

  it("本文のファイル指定が複数、または .drafts/ の外_通さない操作にする", () => {
    const two = "gh pr create --body-file .drafts/a.md --body-file /tmp/b.md";
    expect(classifyCommand(two).forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create -F .drafts/a.md -F .drafts/b.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --body-file -").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --body-file /tmp/b.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --body-file .drafts/../x.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --body-file=.drafts/a.md").forbidden).toEqual([]);
  });

  it("絶対パスの .drafts_通さない操作にする", () => {
    expect(classifyCommand("gh pr create --body-file /x/.drafts/a.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --body-file ./.drafts/a.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("cat /x/.drafts/a.md").forbidden).toEqual([]);
  });

  it("手順どおりの PR の作成_通さない操作にしない", () => {
    const c = 'gh pr create --base main --title "$(head -n 1 .drafts/pr.md)" --body-file <(tail -n +3 .drafts/pr.md)';
    expect(classifyCommand(c).forbidden).toEqual([]);
    expect(classifyCommand(c).drafts).toEqual([".drafts/pr.md"]);
  });

  it("引用符の中の区切りのあとの push と強制 push_引用符を外して拾う", () => {
    expect(classifyCommand('bash -c "echo x && git push"').gates).toHaveLength(1);
    expect(classifyCommand("sh -c 'true; git push --force'").forbidden).toHaveLength(1);
    expect(classifyCommand('bash -c "git push origin x --tags"').forbidden).toHaveLength(1);
  });

  it("引用符で囲んだサブコマンド_拾う", () => {
    expect(classifyCommand("git 'push' origin x").gates).toHaveLength(1);
    expect(classifyCommand('gh "pr" create --title x').gates[0]?.kind).toBe("pr");
  });

  it("gh の new(create の別名)_作成として拾う", () => {
    expect(classifyCommand("gh pr new --title x").gates[0]?.kind).toBe("pr");
    expect(classifyCommand("gh issue new --title x").gates[0]?.kind).toBe("issue");
  });

  it("timeout と caffeinate と setsid のラッパー越しの push_拾う", () => {
    expect(classifyCommand("timeout 30 git push").gates).toHaveLength(1);
    expect(classifyCommand("timeout -k 5 30 git push").gates).toHaveLength(1);
    expect(classifyCommand("caffeinate -i git push").gates).toHaveLength(1);
    expect(classifyCommand("setsid git push").gates).toHaveLength(1);
  });

  it("cd のあとの push と PR の作成_通さない操作にする", () => {
    expect(classifyCommand("cd ../wt-x && git push").forbidden).toHaveLength(1);
    expect(classifyCommand("(cd ../wt-x; gh pr create --title x)").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("pushd ../wt-x && git push").forbidden).toHaveLength(1);
    expect(classifyCommand("if true; then cd ../wt-x; git push; fi").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("{ cd ../wt-x; git push; }").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("! cd ../wt-x && git push").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("cd ../wt-x && npm test").forbidden).toEqual([]);
  });

  it("commit や switch と同じコマンドの push と PR の作成_通さない操作にする", () => {
    expect(classifyCommand("git commit -m x && git push").forbidden).toHaveLength(1);
    expect(classifyCommand("git switch other && git push").forbidden).toHaveLength(1);
    expect(classifyCommand("git commit --amend --no-edit; git push origin x").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("git rebase origin/main && gh pr create --title x").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("git commit -m x").forbidden).toEqual([]);
    expect(classifyCommand("git status && git push").forbidden).toEqual([]);
  });

  it("題の直書き_通さない操作にせず、照合する題として集める。下書きの 1 行目から取る形は集めない", () => {
    const c = classifyCommand("gh pr create --title 'feat(x): y' --body-file .drafts/p.body.md");
    expect(c.forbidden).toEqual([]);
    expect(c.titles).toEqual(["feat(x): y"]);
    expect(classifyCommand("gh pr edit 3 --title=New").titles).toEqual(["New"]);
    expect(classifyCommand("gh pr edit 3 -tNew").titles).toEqual(["New"]);
    expect(classifyCommand("gh pr edit 3 -t New").titles).toEqual(["New"]);
    expect(classifyCommand('gh pr create --title "$(head -n 1 .drafts/pr.md)"').titles).toEqual([]);
    const ok = 'gh pr create --base main --title "$(head -n 1 .drafts/pr.md)" --body-file <(tail -n +3 .drafts/pr.md)';
    expect(classifyCommand(ok).forbidden).toEqual([]);
    expect(classifyCommand('gh issue create --title "$(head -n 1 .drafts/i.md | sed s/x//)"').forbidden).toEqual([]);
  });

  it("題を下書きから取る $(…) のあとの本文の直書きと強制 push_通さない操作にする", () => {
    const title = '--title "$(head -n 1 .drafts/pr.md)"';
    expect(classifyCommand(`gh pr create ${title} --body "x"`).forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand(`gh pr create ${title} --body-file /tmp/b.md`).forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand(`gh pr create ${title} -F .drafts/a.md -F .drafts/b.md`).forbidden.length).toBeGreaterThan(
      0,
    );
    expect(classifyCommand('git push origin "$(git branch --show-current)" --tags').forbidden.length).toBeGreaterThan(
      0,
    );
    expect(classifyCommand('git push origin "$(git branch --show-current)" -f').forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand('git push -u origin "$(git branch --show-current)"').forbidden).toEqual([]);
  });

  it("題を下書きから取る $(… | sed …) のあとの本文の直書き_通さない操作にする", () => {
    const title = "--title \"$(head -n 1 .drafts/i.md | sed 's/^# //')\"";
    expect(classifyCommand(`gh issue create ${title} --body "x"`).forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand(`gh issue create ${title} --body-file /tmp/b.md`).forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand(`gh issue create ${title} --body-file <(tail -n +3 .drafts/i.md)`).forbidden).toEqual([]);
  });

  it("引用符の中の区切りのあとの本文の直書き_通さない操作にする", () => {
    expect(classifyCommand('gh pr create --title "a; b" --body "x"').forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --title 'a && b' --body-file /tmp/b.md").forbidden.length).toBeGreaterThan(0);
  });

  it("if・while・command のあとの cd_通さない操作にする", () => {
    expect(classifyCommand("if cd ../wt-x; then git push; fi").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("while cd ../wt-x; do git push; done").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("command cd ../wt-x && git push").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("time cd ../wt-x && git push").forbidden.length).toBeGreaterThan(0);
  });

  it("題の値が $(…) の全体でない形_直書きとして通さない操作にする", () => {
    expect(classifyCommand('gh pr create --title "$(head -n 1 .drafts/p.md)extra"').forbidden.length).toBeGreaterThan(
      0,
    );
    expect(classifyCommand('gh pr edit 3 -t "$(head -n 1 .drafts/p.md) x"').forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --title --foo").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr edit 3 -t -foo").forbidden.length).toBeGreaterThan(0);
  });

  it("短い -t に $(…) の題_直書きとみなさない", () => {
    expect(classifyCommand('gh pr edit 3 -t "$(head -n 1 .drafts/p.md)"').forbidden).toEqual([]);
    expect(classifyCommand('gh pr edit 3 -t "$(head -n 1 .drafts/p.md)"').titles).toEqual([]);
    expect(classifyCommand("gh pr edit 3 -t New").titles).toEqual(["New"]);
  });

  it("本文のファイル指定の <(…) を先に置いた形_通さない操作にしない", () => {
    expect(classifyCommand("gh pr create --body-file <(tail -n +3 .drafts/p.md) --title t").titles).toEqual(["t"]);
    expect(classifyCommand("gh pr create --body-file <(tail -n +3 .drafts/p.md) --base main").forbidden).toEqual([]);
  });

  it("数字つきのリダイレクトが続く push_送り先と取り違えず、承認があれば通す", () => {
    const approvals = { entries: [entry()] };
    expect(run("git push -u origin chore/#1-v0.1.0 2>&1", approvals).ok).toBe(true);
    expect(run("git push origin HEAD 2>/dev/null", approvals).ok).toBe(true);
    expect(run("git push origin chore/#1-v0.1.0 > /tmp/log 2>&1", approvals).ok).toBe(true);
    expect(classifyCommand("git push -u origin x 2>&1").gates).toMatchObject([{ refspecs: ["x"] }]);
  });

  it("bash -c の引用符の中の cd のあとの push_通さない操作にする", () => {
    expect(classifyCommand('bash -c "cd ../wt-x; git push"').forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("sh -c 'cd ../wt-x && git push'").forbidden.length).toBeGreaterThan(0);
  });

  it("リダイレクトの & は区切らない_push のあとの 2>&1 を別コマンドにしない", () => {
    expect(classifyCommand("git push -u origin x 2>&1").forbidden).toEqual([]);
    expect(classifyCommand("git push origin x &> /tmp/log").gates).toHaveLength(1);
  });

  it("push のあとの別コマンドのオプション_強制 push と取り違えない", () => {
    expect(classifyCommand("git push -u origin x && rm -f tmp.txt").forbidden).toEqual([]);
    expect(classifyCommand("git push -u origin x; ls -d y").forbidden).toEqual([]);
  });

  it("本文の出どころと PR のヘッドを変えるオプション_通さない操作にする", () => {
    expect(classifyCommand("gh pr create --template t.md --title x").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create -T t.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --recover abc").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create --head other --body-file .drafts/p.md").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create -H other").forbidden.length).toBeGreaterThan(0);
    expect(classifyCommand("gh pr create -Bmain --base main").forbidden).toEqual([]);
  });

  it("空白を含む引用符つきの環境変数の代入のあとの push と PR の作成_拾う", () => {
    expect(classifyCommand('NAME="a b" git push').gates).toHaveLength(1);
    expect(classifyCommand("NAME='a b' gh pr create --title x").gates[0]?.kind).toBe("pr");
    expect(classifyCommand('A="x y" B=1 git push --force').forbidden).toHaveLength(1);
  });

  it("リダイレクトが続く push と、値に空白を含む -c つきの commit_拾う", () => {
    expect(classifyCommand("git push>/dev/null").gates).toHaveLength(1);
    expect(classifyCommand("gh pr create>/dev/null").gates[0]?.kind).toBe("pr");
    expect(classifyCommand('git -c "a b" commit -m x && git push').forbidden).toHaveLength(1);
  });

  it("--title に引用符つきの $(…)_直書きとみなさない", () => {
    expect(classifyCommand('gh pr create --title="$(head -n 1 .drafts/p.md)" --base main').forbidden).toEqual([]);
  });

  it("オブジェクトの組み込みの名前で始まるコマンド_例外にせず拾わない", () => {
    expect(classifyCommand("constructor -x").gates).toEqual([]);
    expect(classifyCommand("toString --help").gates).toEqual([]);
  });

  it("パスや先頭の記号つきの git と gh_拾う", () => {
    expect(classifyCommand("/usr/bin/git push").gates).toHaveLength(1);
    expect(classifyCommand("\\git push").gates).toHaveLength(1);
    expect(classifyCommand("/opt/homebrew/bin/gh pr create").gates).toHaveLength(1);
  });

  it("シェルの -c の中の push と PR の作成_拾う", () => {
    expect(classifyCommand('bash -c "git push -u origin x"').gates).toHaveLength(1);
    expect(classifyCommand("sh -lc 'gh pr create --base main'").gates[0]?.kind).toBe("pr");
    expect(classifyCommand("bash -c \"bash -c 'git push -f'\"").forbidden).toHaveLength(1);
  });

  it("ラベルだけの gh の編集_承認の印を要しない軽い操作として拾わない", () => {
    expect(classifyCommand("gh issue edit 3 --add-label later").gates).toEqual([]);
    expect(classifyCommand("gh pr edit 3 --title x").gates).toHaveLength(1);
    expect(classifyCommand("gh issue edit 3 --body-file=.drafts/i.md").gates).toHaveLength(1);
  });

  it("読み取りだけの操作_拾わない", () => {
    expect(classifyCommand("git status && git log --oneline").gates).toEqual([]);
    expect(classifyCommand("gh pr view 3").gates).toEqual([]);
    expect(classifyCommand("echo git push").gates).toEqual([]);
  });

  it("コマンドに現れた下書きのパス_集める", () => {
    const c = classifyCommand(
      'gh pr create --body-file <(tail -n +3 .drafts/pr-x.md) --title "$(head -n 1 .drafts/pr-x.md)"',
    );
    expect(c.drafts).toEqual([".drafts/pr-x.md"]);
  });

  it("短い形の強制 push と commit -n_通さない操作にする", () => {
    expect(classifyCommand("git push -f origin x").forbidden).toHaveLength(1);
    expect(classifyCommand("git push -fu origin x").forbidden).toHaveLength(1);
    expect(classifyCommand("git push origin +x").forbidden).toHaveLength(1);
    expect(classifyCommand("git commit -n -m x").forbidden).toHaveLength(1);
    expect(classifyCommand("git commit -an -m x").forbidden).toHaveLength(1);
    expect(classifyCommand("git commit --no-verify -m x").forbidden).toHaveLength(1);
  });

  it("通常の push と commit_通さない操作にしない", () => {
    expect(classifyCommand("git push -u origin x").forbidden).toEqual([]);
    expect(classifyCommand("git commit --amend -m x").forbidden).toEqual([]);
  });

  it("ブランチの削除とタグの push_通さない操作にする", () => {
    expect(classifyCommand("git push origin --delete x").forbidden).toHaveLength(1);
    expect(classifyCommand("git push origin :x").forbidden).toHaveLength(1);
    expect(classifyCommand("git push origin refs/tags/v1.0.0").forbidden).toHaveLength(1);
    expect(classifyCommand("git push --tags").forbidden).toHaveLength(1);
  });
});

describe("decideHook", () => {
  it("承認の印がない push_止める", () => {
    expect(run("git push -u origin x", none).ok).toBe(false);
  });

  it("承認の印がない PR と Issue の作成_止める", () => {
    expect(run("gh pr create --base main", none).ok).toBe(false);
    expect(run("gh issue create --title x", none).ok).toBe(false);
  });

  it("範囲が承認のときと同じ push_通す", () => {
    expect(run("git push -u origin chore/#1-v0.1.0", { entries: [entry({ kind: "push" })] }).ok).toBe(true);
  });

  it("PR の承認_push も通す", () => {
    expect(run("git push", { entries: [entry()] }).ok).toBe(true);
  });

  it("承認したブランチを同じ名前で送る push_通す", () => {
    const approvals = { entries: [entry()] };
    expect(run("git push -u origin chore/#1-v0.1.0", approvals).ok).toBe(true);
    expect(run("git push origin HEAD", approvals).ok).toBe(true);
    expect(run("git push origin HEAD:chore/#1-v0.1.0", approvals).ok).toBe(true);
    expect(run("git push -u origin chore/#1-v0.1.0:chore/#1-v0.1.0", approvals).ok).toBe(true);
    expect(run('git push -u origin "$(git branch --show-current)"', approvals).ok).toBe(true);
  });

  it("承認したブランチと別の名前へ送る push_止める", () => {
    const approvals = { entries: [entry()] };
    expect(run("git push origin main", approvals).ok).toBe(false);
    expect(run("git push origin HEAD:main", approvals).ok).toBe(false);
    expect(run("git push origin other-branch", approvals).ok).toBe(false);
    expect(run("git push origin other:chore/#1-v0.1.0", approvals).ok).toBe(false);
    expect(run("git push origin chore/#1-v0.1.0 main", approvals).ok).toBe(false);
  });

  it("コマンドを読めない Bash の入力_止める", () => {
    const r = decideHook(
      { tool_name: "Bash", tool_input: {} },
      () => none,
      NOW,
      () => probe(),
    );
    expect(r.ok).toBe(false);
    const r2 = decideHook(
      { tool_name: "Bash" },
      () => none,
      NOW,
      () => probe(),
    );
    expect(r2.ok).toBe(false);
  });

  it("承認のあとにコミットが増えた_止める", () => {
    const approvals = { entries: [entry()] };
    expect(run("git push", approvals, probe({ head: "bbb" })).ok).toBe(false);
    expect(run("git push", approvals, probe({ countFrom: () => 4 })).ok).toBe(false);
  });

  it("承認と別のブランチ_止める", () => {
    expect(run("git push", { entries: [entry()] }, probe({ branch: "other" })).ok).toBe(false);
  });

  it("コミット数を数えられない_止める", () => {
    expect(run("git push", { entries: [entry()] }, probe({ countFrom: () => null })).ok).toBe(false);
  });

  it("有効期限が切れた承認_止める", () => {
    expect(run("git push", { entries: [entry({ expiresAt: NOW - 1 })] }).ok).toBe(false);
  });

  it("push の承認_PR の作成は通さない", () => {
    expect(run("gh pr create --base main", { entries: [entry({ kind: "push" })] }).ok).toBe(false);
  });

  it("承認した下書きと同じ内容_PR の作成を通す", () => {
    expect(run("gh pr create --body-file .drafts/pr.md", { entries: [entry()] }).ok).toBe(true);
  });

  it("承認のあとに下書きが変わった_止める", () => {
    expect(
      run("gh pr create --body-file .drafts/pr.md", { entries: [entry()] }, probe({ hashOf: () => "h2" })).ok,
    ).toBe(false);
  });

  it("下書きを読めない_止める", () => {
    expect(
      run("gh pr create --body-file .drafts/pr.md", { entries: [entry()] }, probe({ hashOf: () => null })).ok,
    ).toBe(false);
  });

  it("下書きのファイルを指さない PR と Issue の作成_承認があっても止める", () => {
    expect(run("gh pr create --base main --title x --body y", { entries: [entry()] }).ok).toBe(false);
    const issue = { entries: [entry({ kind: "issue", branch: "", head: "", count: 0, base: "" })] };
    expect(run("gh issue create --title x --body y", issue).ok).toBe(false);
  });

  it("Issue の承認と同じ下書き_Issue の作成を通す", () => {
    const approvals = { entries: [entry({ kind: "issue", branch: "", head: "", count: 0, base: "" })] };
    expect(run("gh issue create --body-file .drafts/i.md", approvals).ok).toBe(true);
  });

  describe("直書きの題と本文のファイル(置換を使わない形)", () => {
    const title = "fix(scripts): 題の例";
    const withTitle = (over: Partial<ApprovalEntry> = {}) =>
      entry({ draftHash: "h-draft", bodyHash: "h-body", titleHash: sha256(title), ...over });
    const bodyProbe = probe({ hashOf: (p) => (p.endsWith(".body.md") ? "h-body" : "h-draft") });
    const cmd = (t: string) => `gh pr create --base main --title '${t}' --body-file .drafts/pr-fix-1-v0.1.0.body.md`;

    it("承認した題と本文のファイル_PR の作成を通す", () => {
      expect(run(cmd(title), { entries: [withTitle()] }, bodyProbe).ok).toBe(true);
    });

    it("承認した題と違う直書きの題_止める", () => {
      expect(run(cmd("fix(scripts): 別の題"), { entries: [withTitle()] }, bodyProbe).ok).toBe(false);
    });

    it("題のハッシュを持たない古い印_直書きの題を止める", () => {
      expect(run(cmd(title), { entries: [withTitle({ titleHash: undefined })] }, bodyProbe).ok).toBe(false);
    });

    it("承認のあとに本文のファイルが変わった_止める", () => {
      expect(run(cmd(title), { entries: [withTitle()] }, probe({ hashOf: () => "h-other" })).ok).toBe(false);
    });

    it("承認した範囲と違う末尾のコミット_止める", () => {
      expect(run(cmd(title), { entries: [withTitle()] }, probe({ ...bodyProbe, head: "bbb" })).ok).toBe(false);
    });

    it("Issue の作成と、題・本文を変える編集_同じ形で通し、違う題は止める", () => {
      const issue = {
        entries: [withTitle({ kind: "issue", branch: "", head: "", count: 0, base: "" })],
      };
      const body = "--body-file .drafts/issues/x.body.md";
      expect(run(`gh issue create --title '${title}' ${body}`, issue, bodyProbe).ok).toBe(true);
      expect(run(`gh issue edit 3 --title '${title}' ${body}`, issue, bodyProbe).ok).toBe(true);
      expect(run(`gh pr edit 3 -t '${title}' ${body}`, { entries: [withTitle()] }, bodyProbe).ok).toBe(true);
      expect(run(`gh issue edit 3 --title 'x' ${body}`, issue, bodyProbe).ok).toBe(false);
    });

    it("シェルが解釈しうる文字や空の値の直書きの題_通さない操作にする", () => {
      for (const t of ["a $(b)", "a `b`", "a\\b", "a!b"]) {
        expect(classifyCommand(`gh pr create --title "${t}" --body-file .drafts/p.body.md`).forbidden.length).toBe(1);
      }
      expect(classifyCommand('gh pr create --title "it\'s" --body-file .drafts/p.body.md').forbidden).toHaveLength(1);
      expect(classifyCommand("gh pr create --body-file .drafts/p.body.md --title").forbidden).toHaveLength(1);
    });
  });

  describe("# を含む下書きのパス", () => {
    const draft = ".drafts/pr-fix-#1-v0.1.0.md";

    it("手順どおりの $(…) と <(…) の形_パスを取り出し、承認した下書きなら通す", () => {
      const c = `gh pr create --base main --title "$(head -n 1 ${draft})" --body-file <(tail -n +3 ${draft})`;
      expect(classifyCommand(c).drafts).toEqual([draft]);
      expect(run(c, { entries: [entry()] }).ok).toBe(true);
      expect(run(c, { entries: [entry()] }, probe({ hashOf: () => "h2" })).ok).toBe(false);
    });

    it("引用符で囲んだパス_引用符を含めずに取り出す", () => {
      expect(classifyCommand(`gh pr create --body-file '${draft}'`).drafts).toEqual([draft]);
    });
  });

  it("承認があっても強制 push_止める", () => {
    expect(run("git push -f", { entries: [entry({ kind: "push" })] }).ok).toBe(false);
  });

  it("サブエージェントからの push と PR の作成_承認があっても止める", () => {
    const approvals = { entries: [entry()] };
    expect(run("git push", approvals, probe(), "agent-1").ok).toBe(false);
    expect(run("gh pr create --base main", approvals, probe(), "agent-1").ok).toBe(false);
  });

  it("サブエージェントからの承認の印の書き込み_止める", () => {
    expect(run("node scripts/approval.ts grant push", none, probe(), "agent-1").ok).toBe(false);
  });

  it("メインのセッションの承認の印の書き込み_通す", () => {
    expect(run("node scripts/approval.ts grant push", none).ok).toBe(true);
  });

  it("承認の印のファイルを直接触るコマンド_止める", () => {
    expect(run("echo '{}' > .git/mokumoku-approvals.json", none).ok).toBe(false);
    expect(run("node scripts/approval.ts status; echo '{}' > .git/mokumoku-approvals.json", none).ok).toBe(false);
    const edit = decideHook(
      { tool_name: "Write", tool_input: { file_path: "/x/.git/mokumoku-approvals.json" } },
      () => none,
      NOW,
      () => probe(),
    );
    expect(edit.ok).toBe(false);
  });

  it("無関係なコマンド_承認の印も git も読まずに通す", () => {
    const unread = () => {
      throw new Error("読むはずがない");
    };
    const r = decideHook({ tool_name: "Bash", tool_input: { command: "npm test" } }, unread, NOW, unread);
    expect(r.ok).toBe(true);
  });
});

describe("grant と parseApprovals", () => {
  it("同じ種類・同じブランチの承認_置き換える", () => {
    const first = grant(none, entry({ head: "a" }), NOW);
    const second = grant(first, entry({ head: "b" }), NOW);
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]?.head).toBe("b");
  });

  it("期限切れの承認_書くときに捨てる", () => {
    const expired = { entries: [entry({ branch: "old", expiresAt: NOW - 1 })] };
    expect(grant(expired, entry(), NOW).entries).toHaveLength(1);
  });

  it("題と本文のハッシュを持つ印_読み込みで落とさない。型の違う値は落とす", () => {
    const ok = JSON.stringify({ entries: [entry({ titleHash: "t", bodyHash: "b" })] });
    expect(parseApprovals(ok).entries).toHaveLength(1);
    const bad = JSON.stringify({ entries: [{ ...entry(), titleHash: 1 }] });
    expect(parseApprovals(bad).entries).toEqual([]);
  });

  it("壊れた承認の印のファイル_承認なしとして読む", () => {
    expect(parseApprovals("{壊れた")).toEqual({ entries: [] });
    expect(parseApprovals('{"entries":[{"kind":"x"}]}')).toEqual({ entries: [] });
  });
});

describe("splitDraft と bodyPathFor", () => {
  it("PR の下書き_1 行目を題、3 行目以降を本文にする", () => {
    expect(splitDraft("fix: 題\n\n本文 1\n本文 2\n", "pr")).toEqual({ title: "fix: 題", body: "本文 1\n本文 2\n" });
  });

  it("Issue の下書き_題の先頭の「# 」を除く", () => {
    expect(splitDraft("# feat: 題\n\n本文\n", "issue").title).toBe("feat: 題");
  });

  it("改行が CRLF の 1 行目_題の末尾の CR を除く", () => {
    expect(splitDraft("fix: 題\r\n\r\n本文\r\n", "pr").title).toBe("fix: 題");
  });

  it("拡張子が .md の下書き_.body.md の名前にする。ほかは .body を足す", () => {
    expect(bodyPathFor(".drafts/pr-fix-1-v0.1.0.md")).toBe(".drafts/pr-fix-1-v0.1.0.body.md");
    expect(bodyPathFor(".drafts/x.txt")).toBe(".drafts/x.txt.body");
  });
});

describe("デプロイの承認", () => {
  const deployEntry = (over: Partial<ApprovalEntry> = {}) =>
    entry({ kind: "deploy", branch: "v0.1.0", head: "tag1", count: 0, base: "", draftHash: "diff1", ...over });
  const deployProbe = (over: Partial<Probe> = {}) =>
    probe({ head: "tag1", hashOf: (path) => (path === DEPLOY_DIFF_PATH ? "diff1" : null), ...over });

  it("デプロイのコマンドの形_承認が要る操作として拾う", () => {
    for (const command of [
      "cdkd deploy --all",
      "npm run deploy -w @mokumoku-exams/infra -- --all",
      "npm run deploy",
      "npx cdkd deploy",
      "node scripts/with-env.ts cdkd deploy",
      "bash -c 'npm run deploy -w x'",
      "FOO=1 npm run-script deploy",
      "npm -w x run deploy",
      "cdkd --profile p deploy --all",
      "npm rum deploy",
      "npx --yes cdkd deploy",
      "echo ok; cdkd deploy",
    ]) {
      expect(
        classifyCommand(command).gates.map((g) => g.kind),
        command,
      ).toContain("deploy");
    }
  });

  it("デプロイでないコマンド_拾わない", () => {
    for (const command of [
      "npm run diff -w @mokumoku-exams/infra -- --all",
      "npm run build",
      "cdkd diff",
      "cdkd synth",
      "echo deploy",
      "git log --oneline deploy",
      "npm run -w deploy build",
      'grep "cdkd deploy" docs/a.md',
      "echo cdkd deploy",
      "rg cdkd deploy",
      'git commit -m "cdkd deploy を止める"',
      "git commit -F .drafts/commit-msg.txt",
    ]) {
      expect(
        classifyCommand(command).gates.map((g) => g.kind),
        command,
      ).not.toContain("deploy");
    }
  });

  it("承認の印がないデプロイ_止める", () => {
    expect(run("cdkd deploy --all", none, deployProbe()).ok).toBe(false);
    expect(run("npm run deploy -w x", none, deployProbe()).ok).toBe(false);
  });

  it("版のタグのコミットと差分が承認のときと同じ_通す", () => {
    expect(run("cdkd deploy --all", { entries: [deployEntry()] }, deployProbe()).ok).toBe(true);
  });

  it("タグのコミットが違う_止める", () => {
    expect(run("cdkd deploy", { entries: [deployEntry()] }, deployProbe({ head: "tag2" })).ok).toBe(false);
  });

  it("差分が承認のときと違う_止める", () => {
    expect(run("cdkd deploy", { entries: [deployEntry({ draftHash: "other" })] }, deployProbe()).ok).toBe(false);
  });

  it("差分を読めない_止める", () => {
    expect(run("cdkd deploy", { entries: [deployEntry()] }, deployProbe({ hashOf: () => null })).ok).toBe(false);
  });

  it("有効期限が切れた印_止める", () => {
    expect(run("cdkd deploy", { entries: [deployEntry({ expiresAt: NOW - 1 })] }, deployProbe()).ok).toBe(false);
  });

  it("push と PR の印_デプロイは通さない", () => {
    const approvals = { entries: [entry({ kind: "push", head: "tag1" }), entry({ head: "tag1" })] };
    expect(run("cdkd deploy", approvals, deployProbe()).ok).toBe(false);
  });

  it("デプロイの印_pushは通さない", () => {
    expect(run("git push", { entries: [deployEntry()] }, deployProbe()).ok).toBe(false);
  });

  it("サブエージェントからのデプロイ_印があっても止める", () => {
    expect(run("cdkd deploy", { entries: [deployEntry()] }, deployProbe(), "agent-1").ok).toBe(false);
  });

  it("同じ版の承認_置き換える", () => {
    const next = grant({ entries: [deployEntry({ draftHash: "old" })] }, deployEntry({ draftHash: "new" }), NOW);
    expect(next.entries.map((e) => e.draftHash)).toEqual(["new"]);
  });

  it("印の読み込み_deployの種類を受け付ける", () => {
    expect(parseApprovals(JSON.stringify({ entries: [deployEntry()] })).entries).toHaveLength(1);
  });
});
