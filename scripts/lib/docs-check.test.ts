import { describe, expect, it } from "vitest";
import { checkLinks, checkNpmRuns, extractLinks, extractNpmRuns, type ScriptSets } from "./docs-check.ts";

describe("extractLinks", () => {
  it("相対リンク_先と行を取り出し_アンカーとクエリを除く", () => {
    const text = "[a](./x.md)\n[b](../y.md#節)\n[c](docs/z.md?q=1)";
    expect(extractLinks(text)).toEqual([
      { target: "./x.md", line: 1 },
      { target: "../y.md", line: 2 },
      { target: "docs/z.md", line: 3 },
    ]);
  });

  it("外部のURLと#だけとメール_対象にしない", () => {
    expect(
      extractLinks("[a](https://example.com/x)\n[b](#節)\n[c](mailto:a@example.com)\n[d](//example.com/x)"),
    ).toEqual([]);
  });

  it("コードブロックとインラインコードの中_対象にしない", () => {
    const text = "```md\n[a](./x.md)\n```\n`[b](./y.md)`\n[c](./z.md)";
    expect(extractLinks(text)).toEqual([{ target: "./z.md", line: 5 }]);
  });

  it("チルダのコードブロックの中_対象にしない", () => {
    expect(extractLinks("~~~\n[a](./x.md)\n~~~\n[b](./y.md)")).toEqual([{ target: "./y.md", line: 4 }]);
  });

  it("参照形式の定義_先を取り出す", () => {
    expect(extractLinks("[a]: ./x.md\n")).toEqual([{ target: "./x.md", line: 1 }]);
  });

  it("タイトル付きのリンク_先だけを取り出す", () => {
    expect(extractLinks('[a](./x.md "題")')).toEqual([{ target: "./x.md", line: 1 }]);
  });
});

describe("checkLinks", () => {
  const exists = (path: string) => ["docs/a.md", "docs/app/b.md", "README.md"].includes(path);

  it("リンク先が実在する_エラーなし", () => {
    const files = [{ file: "docs/app/c.md", text: "[a](../a.md)\n[b](./b.md)\n[r](../../README.md)" }];
    expect(checkLinks(files, exists)).toEqual([]);
  });

  it("リンク先が実在しない_場所と種類だけを報告する", () => {
    const files = [{ file: "docs/a.md", text: "\n[x](./missing.md)" }];
    expect(checkLinks(files, exists)).toEqual(["docs/a.md:2: リンク先のファイルが存在しない"]);
  });

  it("ディレクトリへのリンク_実在すれば通る", () => {
    const existsDir = (path: string) => path === "docs/app";
    expect(checkLinks([{ file: "docs/a.md", text: "[d](./app/)" }], existsDir)).toEqual([]);
  });

  it("ルートのファイルの_docs始まりのリンク_ルートから解決する", () => {
    expect(checkLinks([{ file: "CLAUDE.md", text: "[a](docs/a.md)" }], exists)).toEqual([]);
  });
});

describe("extractNpmRuns", () => {
  it("npm run_名前とワークスペースと行を取り出す", () => {
    const text = "`npm run build`\n```sh\nnpm run lint -w @s/app\nnpm run -w packages/infra synth -- --x\n```";
    expect(extractNpmRuns(text)).toEqual([
      { name: "build", workspace: null, line: 1 },
      { name: "lint", workspace: "@s/app", line: 3 },
      { name: "synth", workspace: "packages/infra", line: 4 },
    ]);
  });

  it("プレースホルダーと--workspace=の形_正しく扱う", () => {
    const text = "`npm run <名前>`\nnpm run test --workspace=@s/app";
    expect(extractNpmRuns(text)).toEqual([{ name: "test", workspace: "@s/app", line: 2 }]);
  });

  it("コマンドの区切りの後ろ_別のコマンドとして読む", () => {
    expect(extractNpmRuns("npm run a && npm run b -w @s/app").map((r) => r.name)).toEqual(["a", "b"]);
  });
});

describe("checkNpmRuns", () => {
  const scripts: ScriptSets = {
    root: new Set(["build", "lint"]),
    workspaces: new Map([["@s/app", new Set(["dev", "build"])]]),
  };

  it("スクリプトが実在する_エラーなし", () => {
    const files = [{ file: "a.md", text: "npm run build\nnpm run dev -w @s/app" }];
    expect(checkNpmRuns(files, scripts)).toEqual([]);
  });

  it("ルートにないスクリプト_報告する", () => {
    expect(checkNpmRuns([{ file: "a.md", text: "npm run dev" }], scripts)).toEqual([
      "a.md:1: npm run のスクリプトが存在しない",
    ]);
  });

  it("ワークスペースにないスクリプト_報告する", () => {
    expect(checkNpmRuns([{ file: "a.md", text: "npm run lint -w @s/app" }], scripts)).toEqual([
      "a.md:1: npm run のスクリプトが存在しない",
    ]);
  });

  it("存在しないワークスペース_報告する", () => {
    expect(checkNpmRuns([{ file: "a.md", text: "npm run build -w @s/none" }], scripts)).toEqual([
      "a.md:1: npm run のワークスペースが存在しない",
    ]);
  });
});
