import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "./commands.ts";
import { EXIT } from "./exit-codes.ts";
import { main } from "./main.ts";

const validConfig = { workDir: "pipeline-work", ledgerDir: "packages/pipeline/ledger", maxItemsPerRun: 20 };

function configFile(content: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), "pipeline-test-")), "pipeline.config.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function run(argv: string[], { config = validConfig as unknown, env = {} as Record<string, string> } = {}) {
  let out = "";
  let err = "";
  const code = main({
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
  });
  return { code, out, err };
}

describe("コマンドの体系", () => {
  it("引数なし_ヘルプを出して成功する", () => {
    const r = run([]);
    expect(r.code).toBe(EXIT.ok);
    for (const c of COMMANDS) expect(r.out).toContain(c.name);
  });

  it.each(COMMANDS.map((c) => c.name))("%s_--help と --dry-run を受け付ける", (name) => {
    expect(run([name, "--help"]).code).toBe(EXIT.ok);
    const r = run([name, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("未実装");
    expect(r.out).toContain("dry-run");
  });
});

describe("終了コード", () => {
  it("不明なコマンド_入力の誤りで、入力した文字列を出さない", () => {
    const r = run(["no-such-command-xyz"]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err + r.out).not.toContain("no-such-command-xyz");
  });

  it("不明なオプション_入力の誤りで、入力した文字列を出さない", () => {
    const r = run(["collect", "--secret-looking-option"]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err + r.out).not.toContain("secret-looking-option");
  });

  it("想定外の例外_内部の誤りで、クラス名だけを出し、メッセージを出さない", () => {
    let err = "";
    const code = main({
      argv: ["collect"],
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
    });
    expect(code).toBe(EXIT.internalError);
    expect(err).toContain("内部の誤り: TypeError");
    expect(err).not.toContain("leaky-secret-message");
  });
});

describe("設定", () => {
  it("項目の欠落_項目名だけを報告する", () => {
    const r = run(["collect"], { config: { workDir: "x" } });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の欠落: ledgerDir");
    expect(r.err).toContain("設定の欠落: maxItemsPerRun");
  });

  it("値が不正_項目名だけを報告し、値を出さない", () => {
    const r = run(["collect"], { config: { ...validConfig, maxItemsPerRun: "very-secret-value" } });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の不正: maxItemsPerRun");
    expect(r.err + r.out).not.toContain("very-secret-value");
  });

  it("未知の項目_項目名も値も出さずに、不正として報告する", () => {
    const r = run(["collect"], { config: { ...validConfig, someUnknownKey: "unknown-value" } });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の不正: (未知の項目)");
    expect(r.err + r.out).not.toContain("someUnknownKey");
    expect(r.err + r.out).not.toContain("unknown-value");
  });

  it("設定ファイルがない_全項目の欠落として報告する", () => {
    const r = run(["collect"], { config: "{ broken json" });
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("設定の欠落: workDir");
  });

  it("環境値_作業用の置き場を上書きできる。報告に値を出さない", () => {
    const r = run(["collect"], { env: { PIPELINE_WORK_DIR: "custom-dir-value" } });
    expect(r.code).toBe(EXIT.ok);
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
