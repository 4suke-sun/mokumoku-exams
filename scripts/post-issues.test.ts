import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./post-issues.ts", import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 一覧と下書きを置いた一時フォルダを作り、一覧のパスを返す。 */
function setup(entries: unknown, draft = "# chore: 題\n\n本文\n"): string {
  const dir = mkdtempSync(join(tmpdir(), "post-issues-"));
  dirs.push(dir);
  writeFileSync(join(dir, "a.md"), draft);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(entries));
  return join(dir, "manifest.json");
}

const entry = { action: "create", file: "a.md", milestone: "v0.5.0", labels: ["chore"] };

describe("post-issues", () => {
  it("引数がない_使い方を示して終了コード2で終わる", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("使い方");
  });

  it("未知のオプション_終了コード2で終わる", () => {
    expect(run(["m.json", "--post"]).status).toBe(2);
  });

  it("一覧を読めない_スタックトレースを出さず終了コード1で終わる", () => {
    const result = run([join(tmpdir(), "no-such-manifest.json"), "--dry-run"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("一覧を読めない");
    expect(result.stderr).not.toContain("at ");
  });

  it("封印のあとに一覧の項目が変わった_終了コード1で終わる", () => {
    const manifest = setup([entry]);
    run([manifest, "--seal"]);
    const changed = JSON.parse(readFileSync(manifest, "utf8"));
    changed[0].milestone = "v0.6.0";
    writeFileSync(manifest, JSON.stringify(changed));
    const result = run([manifest]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("承認の時点から変わっている");
  });

  it("封印のあとに下書きを直して再び_seal_する_拒否し_reseal_なら通る", () => {
    const manifest = setup([entry]);
    run([manifest, "--seal"]);
    writeFileSync(join(manifest, "..", "a.md"), "# chore: 題を直した\n\n本文\n");
    const again = run([manifest, "--seal"]);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain("--reseal");
    expect(run([manifest, "--reseal"]).status).toBe(0);
    expect(run([manifest, "--dry-run"]).status).toBe(0);
  });

  it("2 行目が空行でない下書き_終了コード1で終わる", () => {
    const manifest = setup([entry], "# chore: 題\n本文が 2 行目にある\n");
    const result = run([manifest, "--seal"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2 行目が空行");
  });

  it("全角コロンの版の行_終了コード1で終わる", () => {
    const result = run([setup([entry], "# chore: 題\n\n- **対象バージョン**：v0.5.0\n"), "--seal"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("版の番号の行");
  });

  it("封印してから確認する_ハッシュを記録しコマンドを表示する", () => {
    const manifest = setup([entry]);
    expect(run([manifest, "--seal"]).status).toBe(0);
    expect(JSON.parse(readFileSync(manifest, "utf8"))[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    const dry = run([manifest, "--dry-run"]);
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("gh issue create");
    expect(dry.stdout).toContain("milestone=v0.5.0");
  });

  it("投稿済みの行_再実行で飛ばし_gh を呼ばない", () => {
    const manifest = setup([{ ...entry, result: { number: 9, title: "chore: 題", url: "https://example.com/9" } }]);
    run([manifest, "--seal"]);
    const result = run([manifest]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("省略(投稿済み: #9)");
    expect(result.stdout).toContain("| #9 | chore: 題 |");
  });

  it("封印がない_dry-runは通り_投稿は終了コード1で止まる", () => {
    const manifest = setup([entry]);
    expect(run([manifest, "--dry-run"]).status).toBe(0);
    const post = run([manifest]);
    expect(post.status).toBe(1);
    expect(post.stderr).toContain("封印がない");
  });

  it("封印のあとに下書きが変わった_終了コード1で終わる", () => {
    const manifest = setup([entry]);
    run([manifest, "--seal"]);
    writeFileSync(join(manifest, "..", "a.md"), "# chore: 題を変えた\n\n本文\n");
    const result = run([manifest]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("承認の時点から変わっている");
  });

  it("下書きに対象バージョンの行がある_終了コード1で終わる", () => {
    const manifest = setup([entry], "# chore: 題\n\n対象バージョン: v0.5.0\n");
    const result = run([manifest, "--seal"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("版の番号の行");
  });
});
