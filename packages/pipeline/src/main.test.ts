import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { EXIT } from "./exit-codes.ts";
import { main } from "./main.ts";

const validConfig = JSON.parse(readFileSync(resolve(import.meta.dirname, "../pipeline.config.json"), "utf8"));

function configFile(content: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "pipeline-test-")), "pipeline.config.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

async function run(argv: string[], { config = validConfig as unknown, env = {} as Record<string, string> } = {}) {
  let out = "";
  let err = "";
  const code = await main({
    argv,
    env,
    output: {
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    },
    configPath: configFile(config),
    rootDir: mkdtempSync(join(tmpdir(), "pipeline-root-")),
  });
  return { code, out, err };
}

describe("コマンドの体系", () => {
  it("解説を別の段階にしない_コマンドの一覧に explain がない", () => {
    expect(COMMANDS.map((c) => c.name)).not.toContain("explain");
  });

  it("引数なし_ヘルプを出して成功する", async () => {
    const r = await run([]);
    expect(r.code).toBe(EXIT.ok);
    for (const c of COMMANDS) expect(r.out).toContain(c.name);
  });

  it.each(COMMANDS.map((c) => c.name))("%s_--help を受け付ける", async (name) => {
    expect((await run([name, "--help"])).code).toBe(EXIT.ok);
  });
});

describe("終了コード", () => {
  it("不明なコマンド_入力の誤りで、入力した文字列を出さない", async () => {
    const r = await run(["no-such-command-xyz"]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err + r.out).not.toContain("no-such-command-xyz");
  });

  it("不明なオプション_入力の誤りで、入力した文字列を出さない", async () => {
    const r = await run(["collect", "--secret-looking-option"]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err + r.out).not.toContain("secret-looking-option");
  });

  it("対応しないコマンドの動作のオプション_入力の誤り", async () => {
    expect((await run(["verify", "--import-guide"])).code).toBe(EXIT.inputError);
    expect((await run(["verify", "AWS-AIB-C01", "--review"])).code).toBe(EXIT.inputError);
    expect((await run(["facts", "--import-guide"])).code).toBe(EXIT.inputError);
    expect((await run(["collect", "--coverage"])).code).toBe(EXIT.inputError);
    expect((await run(["facts", "--import", "--report"])).code).toBe(EXIT.inputError);
  });

  it("collect の資格コードがない、または形が違う_入力の誤りで、入力した文字列を出さない", async () => {
    expect((await run(["collect"])).code).toBe(EXIT.inputError);
    const r = await run(["collect", "secret-looking-code"]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err + r.out).not.toContain("secret-looking-code");
  });

  it("想定外の例外_内部の誤りで、クラス名だけを出し、メッセージを出さない", async () => {
    let err = "";
    // 引数なしは、コマンドの一覧を標準出力に書く。その書き込みで例外を起こす
    const code = await main({
      argv: [],
      env: {},
      output: {
        out: () => {
          throw new TypeError("leaky-secret-message");
        },
        err: (t) => {
          err += t;
        },
      },
      configPath: configFile(validConfig),
      rootDir: tmpdir(),
    });
    expect(code).toBe(EXIT.internalError);
    expect(err).toContain("内部の誤り: TypeError");
    expect(err).not.toContain("leaky-secret-message");
  });
});

describe("設定", () => {
  it("項目の欠落_項目名だけを報告する", async () => {
    const r = await run(["collect"], { config: { workDir: "x" } });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の欠落: ledgerDir");
    expect(r.err).toContain("設定の欠落: maxItemsPerRun");
  });

  it("値が不正_項目名だけを報告し、値を出さない", async () => {
    const r = await run(["collect"], { config: { ...validConfig, maxItemsPerRun: "very-secret-value" } });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の不正: maxItemsPerRun");
    expect(r.err + r.out).not.toContain("very-secret-value");
  });

  it("未知の項目_項目名も値も出さずに、不正として報告する", async () => {
    const r = await run(["collect"], { config: { ...validConfig, someUnknownKey: "unknown-value" } });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の不正: (未知の項目)");
    expect(r.err + r.out).not.toContain("someUnknownKey");
    expect(r.err + r.out).not.toContain("unknown-value");
  });

  it("設定ファイルがない_全項目の欠落として報告する", async () => {
    const r = await run(["collect"], { config: "{ broken json" });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の欠落: workDir");
  });

  it("環境値_作業用の置き場を上書きできる。報告に値を出さない", async () => {
    const r = await run(["plan", "EX-SMP-XX", "--dry-run"], { env: { PIPELINE_WORK_DIR: "custom-dir-value" } });
    expect(r.out + r.err).not.toContain("custom-dir-value");
  });
});

describe("プロセスとして実行", () => {
  const cli = resolve(import.meta.dirname, "cli.ts");
  it("--help_成功する", () => {
    const r = spawnSync("node", [cli, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(EXIT.ok);
    expect(r.stdout).toContain("使い方");
  });
  it("不明なコマンド_終了コードが入力の誤りになる", () => {
    expect(spawnSync("node", [cli, "zzz"], { encoding: "utf8" }).status).toBe(EXIT.inputError);
  });
});

describe(".env.example", () => {
  it("プレースホルダーだけを持つ", () => {
    const text = readFileSync(resolve(import.meta.dirname, "../.env.example"), "utf8");
    const assignments = text.split("\n").filter((l) => /^#?\s*[A-Z][A-Z0-9_]*=/.test(l));
    expect(assignments.length).toBeGreaterThan(0);
    for (const line of assignments) expect(line).toMatch(/=<[^>]+>$/);
  });
});
