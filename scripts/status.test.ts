import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./status.ts", import.meta.url));

describe("status", () => {
  it("gh が使えない環境_gitの項目を表示し_取れなかった項目を示して終了コード0で終わる", () => {
    // gh の認証がない状態にする(GitHub の項目は取得できず、git の項目は表示される)
    // CI の gh は /usr/bin にあるが、トークンを渡さないので認証できない
    const env = {
      ...process.env,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      PATH: `${process.execPath.replace(/\/[^/]+$/, "")}:/usr/bin:/bin`,
    };
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", env });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("## 最新のタグ");
    expect(result.stdout).toContain("## 作業ツリー");
  });
});
