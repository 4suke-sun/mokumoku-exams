import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** 文書に、スクリプト名が 1 つの語として載っているか(別のスクリプト名の一部だけに現れる場合は、載っているとみなさない) */
function mentions(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w:-])${escaped}(?![\\w:-])`).test(text);
}

// 表の形が決まった個別の突き合わせ(スクリプトの一覧と、手引きの説明)。列挙の書き方が文書ごとに違うものは、一般の検査にしない。
describe("CONTRIBUTING.md のコマンドの説明", () => {
  it("ルートの check と validate のスクリプト_すべて名前が CONTRIBUTING.md に載っている", () => {
    const pkg = JSON.parse(read("../package.json")) as { scripts: Record<string, string> };
    const doc = read("../CONTRIBUTING.md");
    const missing = Object.keys(pkg.scripts)
      .filter((name) => /^(check|validate):/.test(name))
      .filter((name) => !mentions(doc, name));
    expect(missing, "CONTRIBUTING.md に載っていないスクリプト").toEqual([]);
  });

  it("名前が別のスクリプト名の一部だけに現れる_載っているとみなさない", () => {
    expect(mentions("`npm run check:env-contract` を実行する", "check:env")).toBe(false);
    expect(mentions("`npm run check:env` を実行する", "check:env")).toBe(true);
    expect(mentions("`verify` が `check:docs`・`check:env` を順に実行する", "check:env")).toBe(true);
  });
});
