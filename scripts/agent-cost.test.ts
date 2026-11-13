import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectDirName } from "./lib/agent-cost.ts";

const script = join(dirname(fileURLToPath(import.meta.url)), "agent-cost.ts");

// 記録の本文・識別子・説明文に当たる目印。どの出力にも出てはならない。
const BODY_MARKER = "本文の目印-プロンプトと応答と道具の出力";
const DESCRIPTION_MARKER = "説明文の目印-サブエージェントの説明";
const SESSION_ID = "00000000-1111-2222-3333-aaaaaaaaaaaa";
const MESSAGE_ID = "msg-識別子の目印";

function line(options: {
  id: string;
  model: string;
  input: number;
  output?: number;
  at?: string;
  sidechain?: boolean;
  body?: string;
}): string {
  return JSON.stringify({
    type: "assistant",
    isSidechain: options.sidechain ?? false,
    timestamp: options.at ?? "2026-10-15T12:00:00.000Z",
    message: {
      id: `${MESSAGE_ID}-${options.id}`,
      model: options.model,
      usage: {
        input_tokens: options.input,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: options.output ?? 0,
      },
      content: [{ type: "text", text: options.body ?? BODY_MARKER }],
    },
  });
}

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

/**
 * 合成の記録の置き場を作る。メイン 1 つ(入力 100 万トークンの Opus 1 回 = $4.00。サブエージェントの分の行が 1 つ混ざる)、
 * サブエージェント 2 つ(verifier は Opus の入力 50 万と出力 10 万 = $4.00、入れ子の reviser は Sonnet の入力 100 万 = $2.00)、
 * 退避した記録(数えない)。
 */
function writeStore(dir: string, extra: { subagentLines?: string[]; mainBody?: string } = {}): void {
  mkdirSync(join(dir, SESSION_ID, "subagents", "workflows", "wf_1"), { recursive: true });
  const mainLines = [
    line({ id: "m1", model: OPUS, input: 1_000_000, body: extra.mainBody }),
    line({ id: "side", model: OPUS, input: 9_000_000, sidechain: true }),
  ];
  writeFileSync(join(dir, `${SESSION_ID}.jsonl`), `${mainLines.join("\n")}\n`);
  writeFileSync(join(dir, `${SESSION_ID}.orphaned-1-xyz.jsonl`), `${mainLines.join("\n")}\n`);
  const sub = join(dir, SESSION_ID, "subagents");
  writeFileSync(
    join(sub, "agent-aaa111.jsonl"),
    `${[line({ id: "v1", model: OPUS, input: 500_000, output: 100_000 }), ...(extra.subagentLines ?? [])].join("\n")}\n`,
  );
  writeFileSync(
    join(sub, "agent-aaa111.meta.json"),
    JSON.stringify({ agentType: "verifier", description: DESCRIPTION_MARKER }),
  );
  writeFileSync(
    join(sub, "workflows", "wf_1", "agent-bbb222.jsonl"),
    `${line({ id: "r1", model: SONNET, input: 1_000_000 })}\n`,
  );
  writeFileSync(
    join(sub, "workflows", "wf_1", "agent-bbb222.meta.json"),
    JSON.stringify({ agentType: "reviser", description: DESCRIPTION_MARKER }),
  );
  writeFileSync(
    join(sub, "workflows", "wf_1", "journal.jsonl"),
    `${line({ id: "j1", model: OPUS, input: 8_000_000 })}\n`,
  );
}

const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), `agent-cost-${prefix}-`));

function run(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  return spawnSync("node", [script, ...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

describe("記録の置き場を指定して実行", () => {
  it("メインとサブエージェントと入れ子のサブエージェントがある_分かれて集計され退避した記録は数えない", () => {
    const store = tmp("store");
    writeStore(store);
    const r = run(["--dir", store]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- メインのセッション: 1 件(うちサブエージェントを使った 1 件)");
    expect(r.stdout).toContain("- サブエージェントの起動: 2 件");
    expect(r.stdout).toContain("- 合計: $10.00");
    expect(r.stdout).toContain("- メイン: $4.00(40.0%)");
    expect(r.stdout).toContain("- サブエージェント: $6.00(60.0%)");
    expect(r.stdout).toContain(`| verifier | ${OPUS} | 1 | 1 | 500,000 | 0 | 0 | 0 | 100,000 | $4.00 |`);
    expect(r.stdout).toContain(`| reviser | ${SONNET} | 1 | 1 | 1,000,000 | 0 | 0 | 0 | 0 | $2.00 |`);
    expect(r.stdout).toContain("費用は、トークン数に API の単価を掛けた見積もりで、請求額ではない");
    expect(r.stderr).toBe("");
  });

  it("本文と説明文と識別子を含む記録_出力にもエラーにも記録の本文・パス・識別子・説明文が出ない", () => {
    const store = tmp("hygiene");
    writeStore(store, { subagentLines: ["not json", "{壊れた行"], mainBody: BODY_MARKER });
    const r = run(["--dir", store]);
    expect(r.status).toBe(0);
    const everything = `${r.stdout}\n${r.stderr}`;
    for (const forbidden of [
      BODY_MARKER,
      DESCRIPTION_MARKER,
      SESSION_ID,
      MESSAGE_ID,
      "aaa111",
      "bbb222",
      "not json",
      "壊れた行",
      store,
      basename(store),
    ]) {
      expect(everything).not.toContain(forbidden);
    }
    expect(r.stderr).toBe("読めない行・必要な項目がない行を 2 件飛ばしました\n");
  });

  it("1行が読み込みの単位より長く複数バイトの文字を含む_途中で切れずに読める", () => {
    const store = tmp("long");
    mkdirSync(store, { recursive: true });
    const long = line({ id: "big", model: OPUS, input: 1_000_000, body: "あ".repeat(1_500_000) });
    writeFileSync(join(store, `${SESSION_ID}.jsonl`), `${long}\n${line({ id: "m2", model: OPUS, input: 1_000_000 })}`);
    const r = run(["--dir", store]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- メイン: $8.00(100.0%)");
    expect(r.stderr).toBe("");
  });

  it("複数の置き場を指定_合算される", () => {
    const a = tmp("a");
    const b = tmp("b");
    writeStore(a);
    writeStore(b);
    const r = run(["--dir", a, "--dir", b]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- メインのセッション: 2 件(うちサブエージェントを使った 2 件)");
    expect(r.stdout).toContain("- 合計: $20.00");
  });

  it("期間を指定_期間に入る応答だけを数え期間の前に書かれた記録は読まない", () => {
    const store = tmp("period");
    writeStore(store);
    const inside = run(["--dir", store, "--since", "2026-10-01", "--until", "2026-10-31"]);
    expect(inside.stdout).toContain("- 合計: $10.00");
    const outside = run(["--dir", store, "--until", "2026-10-14"]);
    expect(outside.status).toBe(0);
    expect(outside.stdout).toContain("- 合計: $0.00");
    expect(outside.stdout).toContain("(期間に記録なし)");
    const future = run(["--dir", store, "--since", "2099-01-01"]);
    expect(future.status).toBe(0);
    expect(future.stdout).toContain("- 合計: $0.00");
  });
});

describe("既定の記録の置き場", () => {
  function makeRepo(): { repo: string; name: string } {
    const repo = tmp("repo");
    spawnSync("git", ["init", "-q"], { cwd: repo });
    return { repo, name: projectDirName(realpathSync(repo)) };
  }

  it("リポジトリと作業ツリーと別のプロジェクトの置き場がある_リポジトリと作業ツリーの分だけが読まれる", () => {
    const { repo, name } = makeRepo();
    const config = tmp("config");
    const projects = join(config, "projects");
    for (const dir of [name, `${name}-wt-wt-v1`, `${name}2`]) {
      mkdirSync(join(projects, dir), { recursive: true });
    }
    writeStore(join(projects, name));
    // 作業ツリーのセッションは、別の識別子(サブエージェントなし)
    writeFileSync(
      join(projects, `${name}-wt-wt-v1`, "11111111-2222-3333-4444-bbbbbbbbbbbb.jsonl"),
      `${line({ id: "w1", model: OPUS, input: 1_000_000 })}\n`,
    );
    // 別のプロジェクト(名前が英数字で続く)は読まない
    writeFileSync(
      join(projects, `${name}2`, "22222222-3333-4444-5555-cccccccccccc.jsonl"),
      `${line({ id: "x1", model: OPUS, input: 5_000_000 })}\n`,
    );
    const r = run([], { cwd: repo, env: { CLAUDE_CONFIG_DIR: config } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("- メインのセッション: 2 件(うちサブエージェントを使った 1 件)");
    expect(r.stdout).toContain("- 合計: $14.00");
    expect(`${r.stdout}${r.stderr}`).not.toContain(config);
  });

  it("このリポジトリの置き場がない_終了コード1で記録の置き場の指定を案内しパスを出さない", () => {
    const { repo } = makeRepo();
    const config = tmp("empty-config");
    mkdirSync(join(config, "projects", "-other-project"), { recursive: true });
    const r = run([], { cwd: repo, env: { CLAUDE_CONFIG_DIR: config } });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("このリポジトリの記録が、既定の置き場に見つかりませんでした");
    expect(r.stderr).toContain("--dir");
    expect(r.stderr).not.toContain(config);
    expect(r.stderr).not.toContain(repo);
  });

  it("gitのリポジトリでない場所で置き場を指定しない_終了コード1になる", () => {
    const dir = tmp("nogit");
    const r = run([], { cwd: dir, env: { CLAUDE_CONFIG_DIR: tmp("cfg"), GIT_CEILING_DIRECTORIES: dirname(dir) } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("作業ツリーの一覧を取れませんでした");
    expect(r.stderr).not.toContain(dir);
  });
});

describe("終了コード", () => {
  it("存在しない記録の置き場を指定_終了コード1でパスを出さない", () => {
    const missing = join(tmp("missing"), "ない置き場");
    const r = run(["--dir", missing]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("指定した記録の置き場を読めませんでした\n");
  });

  it("日付が不正・始まりが終わりより後・知らない引数・位置引数_終了コード2で使い方を出す", () => {
    for (const args of [
      ["--since", "2026-02-30"],
      ["--until", "昨日"],
      ["--since", "2026-10-20", "--until", "2026-10-10"],
      ["--unknown"],
      ["余分な引数"],
      ["--since"],
    ]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("使い方: node scripts/agent-cost.ts");
    }
  });
});
