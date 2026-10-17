import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PathsError } from "./errors.ts";
import { writeFileAtomic, writeJson } from "./fs.ts";

describe("書き出し", () => {
  it("一時ファイルを経由して置き換える_一時ファイルは残らない", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-fs-"));
    writeFileAtomic(join(dir, "a", "b.txt"), "本体");
    writeFileAtomic(join(dir, "a", "b.txt"), "置き換え");
    expect(readFileSync(join(dir, "a", "b.txt"), "utf8")).toBe("置き換え");
    expect(readdirSync(join(dir, "a"))).toEqual(["b.txt"]);
  });

  it("JSON を書く_整形して末尾に改行を付け、親のディレクトリを作る", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-fs-"));
    writeJson(join(dir, "x", "y.json"), { a: 1 });
    expect(readFileSync(join(dir, "x", "y.json"), "utf8")).toBe('{\n  "a": 1\n}\n');
  });
});

describe("項目のパスだけを持つ誤り", () => {
  it("基底の型_メッセージと場所を持つ", () => {
    const error = new PathsError("台帳の誤り", ["a.b"]);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("台帳の誤り");
    expect(error.paths).toEqual(["a.b"]);
  });
});
