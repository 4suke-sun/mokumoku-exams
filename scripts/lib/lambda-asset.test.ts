import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLambdaAsset } from "./lambda-asset.ts";

let root: string;
let appDir: string;
let outDir: string;

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lambda-asset-"));
  appDir = join(root, "app");
  outDir = join(root, "dist");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function fakeBuild() {
  write(join(appDir, ".next/standalone/packages/app/server.js"), "// server");
  write(join(appDir, ".next/standalone/node_modules/x/index.js"), "// dep");
  write(join(appDir, ".next/static/chunks/a.js"), "// chunk");
}

describe("buildLambdaAsset", () => {
  it("ビルド済みの成果物から_Lambda 用と静的ファイル用のディレクトリを作る", () => {
    fakeBuild();
    const { lambdaDir, staticDir } = buildLambdaAsset({ appDir, outDir });

    expect(existsSync(join(lambdaDir, "packages/app/server.js"))).toBe(true);
    expect(existsSync(join(lambdaDir, "node_modules/x/index.js"))).toBe(true);
    expect(readFileSync(join(lambdaDir, "run.sh"), "utf8")).toContain("exec node server.js");
    expect(statSync(join(lambdaDir, "run.sh")).mode & 0o111).not.toBe(0);
    expect(existsSync(join(staticDir, "_next/static/chunks/a.js"))).toBe(true);
  });

  it("public がある_静的ファイルの直下に置く", () => {
    fakeBuild();
    write(join(appDir, "public/robots.txt"), "User-agent: *");
    const { staticDir } = buildLambdaAsset({ appDir, outDir });
    expect(existsSync(join(staticDir, "robots.txt"))).toBe(true);
  });

  it("2 回実行する_前回の出力を残さない", () => {
    fakeBuild();
    buildLambdaAsset({ appDir, outDir });
    write(join(outDir, "lambda/stale.txt"), "old");
    const { lambdaDir } = buildLambdaAsset({ appDir, outDir });
    expect(existsSync(join(lambdaDir, "stale.txt"))).toBe(false);
  });

  it("ビルド済みでない_ビルドを促して失敗する", () => {
    expect(() => buildLambdaAsset({ appDir, outDir })).toThrow(/npm run build/);
  });
});
