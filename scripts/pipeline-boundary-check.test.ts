import { describe, expect, it } from "vitest";
import { checkPipelineBoundary } from "./lib/pipeline-boundary-check.ts";

const file = (text: string, path = "packages/pipeline/src/a.ts") => checkPipelineBoundary([{ path, text }]);

describe("pipeline の境界の検査", () => {
  it("契約のパッケージと同じパッケージ内の相対参照_違反なし", () => {
    const text = [
      'import { x } from "@mokumoku-exams/data-schema/exam-data/schema";',
      'import { y } from "./contract.ts";',
      'import { z } from "../util/z.ts";',
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    expect(file(text, "packages/pipeline/src/sub/a.ts")).toEqual([]);
  });

  it("アプリの内部への相対参照_違反として行と種類を返す", () => {
    const text = 'import a from "x";\nimport { b } from "../../app/src/lib/types.ts";';
    expect(file(text, "packages/pipeline/src/a.ts")).toEqual([
      { file: "packages/pipeline/src/a.ts", line: 2, kind: "アプリの内部への相対参照" },
    ]);
  });

  it("パッケージの外への相対参照_違反", () => {
    expect(file('export * from "../../../scripts/lib/git-check.ts";')).toEqual([
      { file: "packages/pipeline/src/a.ts", line: 1, kind: "パッケージの外への相対参照" },
    ]);
  });

  it("アプリ・インフラのパッケージ名と別名の参照_違反", () => {
    const text = [
      'import a from "@mokumoku-exams/app/src/x";',
      'import b from "@mokumoku-exams/infra";',
      'import c from "@/lib/types";',
    ].join("\n");
    expect(file(text).map((v) => v.kind)).toEqual([
      "他のワークスペースのパッケージの参照",
      "他のワークスペースのパッケージの参照",
      "アプリのパスの別名の参照",
    ]);
  });

  it("動的 import と require_検出する", () => {
    const text = 'const a = await import("../../app/x.ts");\nconst b = require("@mokumoku-exams/app");';
    expect(file(text).map((v) => v.line)).toEqual([1, 2]);
  });

  it("報告に import の文字列が含まれない", () => {
    const out = JSON.stringify(file('import a from "../../app/secret-name.ts";'));
    expect(out).not.toContain("secret-name");
  });

  it("文字列が次の行にある import_検出し、from または import( のある行を返す", () => {
    expect(file('import {\n  a,\n} from\n  "../../app/x.ts";').map((v) => v.line)).toEqual([3]);
    expect(file('const m = await import(\n  "../../app/x.ts",\n);').map((v) => v.line)).toEqual([1]);
  });

  it("バッククォートと require.resolve と new URL_検出する", () => {
    const text = [
      "const a = await import(`../../app/x.ts`);",
      'const b = require.resolve("@mokumoku-exams/app");',
      'const c = new URL("../../app/x.ts", import.meta.url);',
    ].join("\n");
    expect(file(text).map((v) => v.line)).toEqual([1, 2, 3]);
  });

  it("リポジトリ内のパスの直接参照_違反", () => {
    expect(file('import a from "packages/app/src/x.ts";')[0]?.kind).toBe("リポジトリ内のパスの直接参照");
    expect(file('import a from "/abs/x.ts";')[0]?.kind).toBe("リポジトリ内のパスの直接参照");
  });
});
