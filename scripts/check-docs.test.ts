import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOC_PATTERNS } from "./lib/docs-check.ts";
import { git } from "./lib/git-check.ts";

const script = fileURLToPath(new URL("./check-docs.ts", import.meta.url));

describe("check-docs", () => {
  it("リポジトリの文書_参照がすべて実在し終了コード0で終わる", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, CI: "1" } });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("対象の指定_docs直下と深い階層とスキルとパッケージの文書をすべて含む", () => {
    const paths = git(["ls-files", "--", ...DOC_PATTERNS]).split("\n");
    for (const expected of [
      "README.md",
      "docs/known-issues.md",
      "docs/app/infra.md",
      "docs/app/adr/README.md",
      ".claude/skills/dev-pr/SKILL.md",
      "packages/pipeline/README.md",
    ]) {
      expect(paths, expected).toContain(expected);
    }
  });
});
