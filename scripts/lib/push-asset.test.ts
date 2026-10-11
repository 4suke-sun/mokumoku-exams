import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compilePushSources, copyPackageClosure } from "./push-asset.ts";

let root: string;

function pkg(dir: string, manifest: Record<string, unknown>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "index.js"), "// code");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "push-asset-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("copyPackageClosure", () => {
  it("依存をたどって写し_入れ子の node_modules は置かれていた形のまま写す", () => {
    pkg(join(root, "node_modules/a"), { name: "a", dependencies: { b: "1", c: "2" } });
    pkg(join(root, "node_modules/b"), { name: "b" });
    pkg(join(root, "node_modules/c"), { name: "c", version: "1" });
    pkg(join(root, "node_modules/a/node_modules/c"), { name: "c", version: "2", optionalDependencies: { d: "1" } });
    pkg(join(root, "node_modules/unused"), { name: "unused" });
    const outDir = join(root, "out");

    const count = copyPackageClosure({ names: ["a"], fromDir: join(root, "packages/app"), root, outDir });

    expect(count).toBe(3);
    expect(existsSync(join(outDir, "node_modules/a/index.js"))).toBe(true);
    expect(existsSync(join(outDir, "node_modules/b/index.js"))).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, "node_modules/a/node_modules/c/package.json"), "utf8")).version).toBe(
      "2",
    );
    // a からは入れ子の c を使うので、直下の c と、使わないパッケージは写さない。入っていない任意の依存は飛ばす
    expect(existsSync(join(outDir, "node_modules/c"))).toBe(false);
    expect(existsSync(join(outDir, "node_modules/unused"))).toBe(false);
  });

  it("ワークスペースの node_modules にあるパッケージ_直下の node_modules に写す", () => {
    pkg(join(root, "packages/app/node_modules/a"), { name: "a" });
    const outDir = join(root, "out");
    copyPackageClosure({ names: ["a"], fromDir: join(root, "packages/app"), root, outDir });
    expect(existsSync(join(outDir, "node_modules/a/index.js"))).toBe(true);
  });

  it("必要な依存が見つからない_npm ci を促して失敗する", () => {
    pkg(join(root, "node_modules/a"), { name: "a", dependencies: { missing: "1" } });
    expect(() => copyPackageClosure({ names: ["a"], fromDir: root, root, outDir: join(root, "out") })).toThrow(
      /npm ci/,
    );
  });
});

describe("compilePushSources", () => {
  it("送信の Lambda のファイルを_ES モジュールの JavaScript にし_別名の読み込みを残さない", () => {
    const repo = resolve(import.meta.dirname, "../..");
    const outDir = join(root, "push");
    compilePushSources(repo, outDir);
    for (const name of ["daily.js", "send.js", "endpoint.js"]) expect(existsSync(join(outDir, name)), name).toBe(true);
    expect(JSON.parse(readFileSync(join(outDir, "package.json"), "utf8"))).toEqual({ type: "module" });
    const daily = readFileSync(join(outDir, "daily.js"), "utf8");
    expect(daily).toContain('from "./send.js"');
    expect(daily).toContain("export async function handler");
  });
});
