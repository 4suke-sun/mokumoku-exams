import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DENYLIST_FILE, denylistCandidates, loadDenylist, MISSING_MESSAGE, resolveDenylist } from "./local-denylist.ts";

describe("denylistCandidates", () => {
  it("作業ツリーと主の作業ツリーが別_両方を返す", () => {
    expect(denylistCandidates("/work/wt", "/work/main/.git")).toEqual([
      `/work/wt/${DENYLIST_FILE}`,
      `/work/main/${DENYLIST_FILE}`,
    ]);
  });

  it("主の作業ツリーそのもの_重複を除いて 1 つにする", () => {
    expect(denylistCandidates("/work/main", "/work/main/.git")).toEqual([`/work/main/${DENYLIST_FILE}`]);
  });

  it("git の外_候補なし", () => {
    expect(denylistCandidates(null, null)).toEqual([]);
  });
});

describe("loadDenylist", () => {
  const files: Record<string, string> = { "/a": "# コメント\nalpha\n\n", "/b": "beta\n" };
  const read = (p: string) => {
    if (p in files) return files[p] as string;
    throw new Error("ENOENT");
  };

  it("作業ツリーの直下だけにある_その語を返す", () => {
    expect(loadDenylist(["/a", "/none"], read)).toEqual(["alpha"]);
  });

  it("主の作業ツリーだけにある_その語を返す", () => {
    expect(loadDenylist(["/none", "/b"], read)).toEqual(["beta"]);
  });

  it("両方にある_語を合わせる", () => {
    expect(loadDenylist(["/a", "/b"], read)).toEqual(["alpha", "beta"]);
  });

  it("どこにもない_null を返す", () => {
    expect(loadDenylist(["/none"], read)).toBeNull();
    expect(loadDenylist([], read)).toBeNull();
  });

  it("コメントだけのファイル_読めたものとして空の語を返す", () => {
    expect(loadDenylist(["/c"], () => "# 語なし\n")).toEqual([]);
  });
});

describe("resolveDenylist", () => {
  it("見つかった_そのまま返す", () => {
    expect(resolveDenylist(["x"], {})).toEqual(["x"]);
  });

  it("見つからず手元_null で止める", () => {
    expect(resolveDenylist(null, {})).toBeNull();
  });

  it("見つからず CI_空のリストで続ける", () => {
    expect(resolveDenylist(null, { CI: "true" })).toEqual([]);
  });
});

describe("check-pr-secrets(拒否リストの有無)", () => {
  const script = fileURLToPath(new URL("../check-pr-secrets.ts", import.meta.url));

  function run(dir: string, env: Record<string, string>) {
    const draft = join(dir, "draft.md");
    writeFileSync(draft, "題\n\n本文\n");
    const { CI: _ci, ...base } = process.env;
    return spawnSync("node", [script, draft], { cwd: dir, encoding: "utf8", env: { ...base, ...env } });
  }

  function makeRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), "denylist-"));
    spawnSync("git", ["init", "-q", "-b", "work"], { cwd: dir });
    return dir;
  }

  it("手元でリストがない_終了コード 1 で置き場と書式を案内する", () => {
    const r = run(makeRepo(), {});
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(MISSING_MESSAGE);
  });

  it("CI でリストがない_検査を続けて通す", () => {
    expect(run(makeRepo(), { CI: "true" }).status).toBe(0);
  });

  it("別の作業ツリー_主の作業ツリーのリストの語が効く", () => {
    const main = makeRepo();
    const word = "テスト" + "用語";
    writeFileSync(join(main, DENYLIST_FILE), `${word}\n`);
    spawnSync(
      "git",
      ["-c", "user.email=a@example.com", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i"],
      {
        cwd: main,
      },
    );
    const wt = join(mkdtempSync(join(tmpdir(), "denylist-wt-")), "wt");
    spawnSync("git", ["worktree", "add", "-q", "-b", "other", wt], { cwd: main });
    const draft = join(wt, "draft.md");
    writeFileSync(draft, `題\n\n${word}を含む\n`);
    const { CI: _ci, ...base } = process.env;
    const r = spawnSync("node", [script, draft], { cwd: wt, encoding: "utf8", env: base });
    expect(r.status).toBe(1);
    // 「リストが見つからず止まった」のではなく、リストの語が効いて止まったことを確かめる
    expect(r.stderr).not.toContain(MISSING_MESSAGE);
    expect(r.stderr).toContain("拒否リストの 1 番目の語");
    expect(r.stdout + r.stderr).not.toContain(word);
  });
});
