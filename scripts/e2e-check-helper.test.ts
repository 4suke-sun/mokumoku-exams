import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// E2E で、選択肢やチェックボックスを直接 check すると、画面の準備の前に押したときに状態が変わらず、
// 再試行でだけ通る不安定な試験になる(CI は再試行で通った試験も失敗にする)。チェックは、押し直す補助だけで行う。
const E2E_DIR = fileURLToPath(new URL("../packages/app/e2e/", import.meta.url));
const HELPER = "checkUntilChecked";

/** 補助の定義の本体を除いた本文で、`.check(` と `.setChecked(` を呼ぶ行の番号 */
function directChecks(source: string): number[] {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => new RegExp(`function ${HELPER}\\b`).test(l));
  // 補助の本体は、定義の行から、行頭の `}` までとみなす
  const end = start >= 0 ? lines.findIndex((l, i) => i > start && /^}/.test(l)) : -1;
  return lines
    .map((line, i) => ({ line, n: i + 1, inHelper: start >= 0 && i >= start && i <= end }))
    .filter(({ line, inHelper }) => !inHelper && /\.(check|setChecked)\(/.test(line))
    .map(({ n }) => n);
}

describe("E2E のチェックの操作", () => {
  it("E2E の試験のファイル_補助の外で直接 check していない", () => {
    const files = readdirSync(E2E_DIR).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((f) => directChecks(readFileSync(join(E2E_DIR, f), "utf8")).map((n) => `${f}:${n}`));
    expect(found, `${HELPER} を使ってください`).toEqual([]);
  });

  it("補助の外の check と setChecked_行の番号を返し、補助の中は数えない", () => {
    const source = [
      `async function ${HELPER}(t) {`,
      "  await t.check({ force: true });",
      "}",
      "await choice.check();",
      "await box.setChecked(true);",
      "await other.click();",
    ].join("\n");
    expect(directChecks(source)).toEqual([4, 5]);
  });
});
