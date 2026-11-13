import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_FILE,
  aggregate,
  defaultProjectsRoot,
  formatCostReport,
  MAIN_LABEL,
  OTHER_MODEL,
  type Period,
  type PriceTable,
  parseAgentType,
  parseLine,
  parsePeriod,
  parsePriceTable,
  projectDirName,
  readTranscript,
  responseCost,
  SESSION_FILE,
  selectProjectDirs,
  skippedNote,
  type TranscriptInput,
  UNKNOWN_AGENT,
  worktreeRoots,
} from "./agent-cost.ts";

// 記録の本文に当たる目印。どの出力にも出てはならない。
const BODY_MARKER = "本文の目印-プロンプトと応答と道具の出力";
const ALL_TIME: Period = { since: null, until: null, sinceMs: null, untilMs: null };

interface LineOptions {
  id: string;
  model?: string;
  at?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  split?: { m5: number; h1: number };
  sidechain?: boolean;
}

/** 応答の行を、テストの中で合成する。本文の目印を、応答の内容に入れておく。 */
function line(o: LineOptions): string {
  const usage: Record<string, unknown> = {
    input_tokens: o.input ?? 0,
    cache_creation_input_tokens: o.cacheWrite ?? (o.split ? o.split.m5 + o.split.h1 : 0),
    cache_read_input_tokens: o.cacheRead ?? 0,
    output_tokens: o.output ?? 0,
  };
  if (o.split) {
    usage.cache_creation = { ephemeral_5m_input_tokens: o.split.m5, ephemeral_1h_input_tokens: o.split.h1 };
  }
  return JSON.stringify({
    type: "assistant",
    isSidechain: o.sidechain ?? false,
    timestamp: o.at ?? "2026-10-15T12:00:00.000Z",
    message: {
      id: o.id,
      model: o.model ?? "claude-test-a",
      usage,
      content: [{ type: "text", text: BODY_MARKER }],
    },
  });
}

// 100 万トークンあたり: 入力 1、書き込み 5 分 2、1 時間 4、読み込み 0.5、出力 10。長い入力は 2 倍(入力が 100 万を超えるとき)
const prices: PriceTable = (() => {
  const table = parsePriceTable({
    source: "テスト用の単価表",
    checkedOn: "2026-01-01",
    unit: "100万トークンあたりのドル",
    notes: [],
    models: {
      "claude-test-a": { input: 1, cacheWrite5m: 2, cacheWrite1h: 4, cacheRead: 0.5, output: 10 },
      "claude-test-b": {
        input: 1,
        cacheWrite5m: 1,
        cacheWrite1h: 1,
        cacheRead: 1,
        output: 1,
        longContext: { overTokens: 1_000_000, input: 2, cacheWrite5m: 2, cacheWrite1h: 2, cacheRead: 2, output: 2 },
      },
    },
  });
  if (table === null) throw new Error("テスト用の単価表が読めない");
  return table;
})();

const transcript = (lines: string[], excludeSidechain = false) => readTranscript(lines, { excludeSidechain });

const main = (lines: string[], session = 1): TranscriptInput => ({
  kind: "main",
  agent: null,
  session,
  transcript: transcript(lines, true),
});
const sub = (agent: string, lines: string[], session = 1): TranscriptInput => ({
  kind: "subagent",
  agent,
  session,
  transcript: transcript(lines),
});

describe("readTranscript の重なる行", () => {
  it("同じmessageIDの行が2つで最初のoutputが小さい_大きいほうだけが数えられる", () => {
    const t = transcript([
      line({ id: "m1", input: 10, output: 5, at: "2026-10-15T12:00:00.000Z" }),
      line({ id: "m1", input: 10, output: 300, at: "2026-10-15T12:00:01.000Z" }),
    ]);
    expect(t.responses).toHaveLength(1);
    expect(t.responses[0]?.usage.output).toBe(300);
    expect(t.responses[0]?.usage.input).toBe(10);
  });

  it("大きいoutputの行が先にある_大きいほうが残る", () => {
    const t = transcript([line({ id: "m1", output: 300 }), line({ id: "m1", output: 5 })]);
    expect(t.responses.map((r) => r.usage.output)).toEqual([300]);
  });

  it("重なる行がある_集計の応答の数と費用に1回分だけが入る", () => {
    const report = aggregate(
      [main([line({ id: "m1", output: 1_000_000 }), line({ id: "m1", output: 2_000_000 })])],
      ALL_TIME,
      prices,
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.responses).toBe(1);
    expect(report.rows[0]?.tokens.output).toBe(2_000_000);
    expect(report.mainCost).toBeCloseTo(20);
  });
});

describe("parseLine のキャッシュの書き込み", () => {
  it("cache_creationの内訳がある_5分と1時間に分かれて数えられる", () => {
    const r = parseLine(line({ id: "m1", split: { m5: 100, h1: 40 } }));
    expect(r.kind === "response" && r.response.usage).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 40 });
  });

  it("cache_creationがない_cache_creation_input_tokensが5分の書き込みになる", () => {
    const r = parseLine(line({ id: "m1", cacheWrite: 70 }));
    expect(r.kind === "response" && r.response.usage).toMatchObject({ cacheWrite5m: 70, cacheWrite1h: 0 });
  });
});

describe("parseLine のモデルの ID", () => {
  it("claude-で始まらないモデルのID_その他のモデルにまとめられ元のIDが残らない", () => {
    const cloudId = "arn:cloud:service:region-x:ACCOUNT-MARK:profile/claude-test-a";
    const r = parseLine(line({ id: "m1", model: cloudId }));
    expect(r.kind === "response" && r.response.model).toBe(OTHER_MODEL);
    expect(JSON.stringify(r)).not.toContain("ACCOUNT-MARK");
  });

  it("claude-で始まり長い数字の並びを含むモデルのID_その他のモデルにまとめられる", () => {
    const digits = "7".repeat(12);
    const r = parseLine(line({ id: "m1", model: `claude-test-${digits}` }));
    expect(r.kind === "response" && r.response.model).toBe(OTHER_MODEL);
    expect(JSON.stringify(r)).not.toContain(digits);
  });
});

describe("readTranscript の飛ばす行", () => {
  it("モデルがsyntheticの行_数えずに件数だけが数えられる", () => {
    const t = transcript([line({ id: "m1", model: "<synthetic>", output: 9 }), line({ id: "m2" })]);
    expect(t.responses.map((r) => r.id)).toEqual(["m2"]);
    expect(t.synthetic).toBe(1);
    expect(t.malformed).toBe(0);
  });

  it("読めない行と必要な項目がない行_飛ばされて件数だけが報告される", () => {
    const noUsage = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-15T12:00:00.000Z",
      message: { id: "m9", model: "claude-test-a", content: BODY_MARKER },
    });
    const truncated = line({ id: "m8" }).slice(0, 80);
    const badNumber = line({ id: "m7" }).replace('"output_tokens":0', '"output_tokens":"x"');
    const t = transcript([line({ id: "m1" }), "not json", truncated, noUsage, badNumber, "", line({ id: "m2" })]);
    expect(t.responses.map((r) => r.id)).toEqual(["m1", "m2"]);
    expect(t.malformed).toBe(4);
    const report = aggregate([sub("x", [line({ id: "m1" }), "not json"])], ALL_TIME, prices);
    expect(skippedNote(report)).toBe("読めない行・必要な項目がない行を 1 件飛ばしました\n");
    expect(skippedNote(report)).not.toContain("not json");
  });

  it("応答でない行_読まずに数えない", () => {
    const user = JSON.stringify({ type: "user", message: { role: "user", content: BODY_MARKER } });
    const t = transcript([user, JSON.stringify({ type: "system", content: BODY_MARKER }), line({ id: "m1" })]);
    expect(t.responses).toHaveLength(1);
    expect(t.malformed).toBe(0);
    expect(parseLine(user).kind).toBe("ignored");
  });

  it("メインの記録でisSidechainが真の行_数えられない", () => {
    const lines = [
      line({ id: "m1" }),
      line({ id: "s1", sidechain: true }),
      line({ id: "s2", model: "<synthetic>", sidechain: true }),
    ];
    const t = transcript(lines, true);
    expect(t.responses.map((r) => r.id)).toEqual(["m1"]);
    expect(t.synthetic).toBe(0);
    expect(transcript(lines, false).responses).toHaveLength(2);
  });
});

describe("aggregate のメインとサブエージェント", () => {
  it("メインとサブエージェントがある_分かれて集計され定義ごと・モデルごとに分かれる", () => {
    const report = aggregate(
      [
        main([line({ id: "a1", model: "claude-test-a", output: 100 })]),
        sub("verifier", [
          line({ id: "b1", model: "claude-test-a", output: 10 }),
          line({ id: "b2", model: "claude-test-b", output: 20 }),
        ]),
        sub("verifier", [line({ id: "c1", model: "claude-test-a", output: 30 })], 2),
        sub("writer", [line({ id: "d1", model: "claude-test-b", output: 40 })], 2),
      ],
      ALL_TIME,
      prices,
    );
    const key = (r: { agent: string; model: string }) => `${r.agent}/${r.model}`;
    expect(report.rows.map(key).sort()).toEqual([
      `${MAIN_LABEL}/claude-test-a`,
      "verifier/claude-test-a",
      "verifier/claude-test-b",
      "writer/claude-test-b",
    ]);
    const row = (k: string) => report.rows.find((r) => key(r) === k);
    expect(row("verifier/claude-test-a")).toMatchObject({ launches: 2, responses: 2 });
    expect(row("verifier/claude-test-b")).toMatchObject({ launches: 0, responses: 1 });
    expect(row(`${MAIN_LABEL}/claude-test-a`)).toMatchObject({ responses: 1 });
    expect(report.launches).toBe(3);
    expect(report.mainSessions).toBe(1);
    expect(report.sessionsWithSubagents).toBe(2);
    expect(report.mainCost).toBeCloseTo((100 * 10) / 1_000_000);
    expect(report.subagentCost).toBeCloseTo((10 * 10 + 30 * 10 + 20 * 1 + 40 * 1) / 1_000_000);
  });
});

describe("aggregate の起動分", () => {
  it("サブエージェントに複数の応答がある_最初の応答だけから起動分が計算される", () => {
    const report = aggregate(
      [
        sub("verifier", [
          line({ id: "b1", input: 100, cacheWrite: 400, cacheRead: 500, output: 2_000_000 }),
          line({ id: "b2", input: 7_000, cacheRead: 90_000, output: 5 }),
        ]),
        sub("verifier", [line({ id: "c1", input: 1_000_000, output: 3 })], 2),
      ],
      ALL_TIME,
      prices,
    );
    const startup = report.startup.find((s) => s.agent === "verifier");
    expect(startup?.launches).toBe(2);
    // 最初の応答の入力: 100 + 400 + 500 と 1,000,000(2 番目の応答の 97,000 は入らない)
    expect(startup?.tokens).toBe(1_001_000);
    // 入力の費用: (100×1 + 400×2 + 500×0.5)/100万 と 1,000,000×1/100万
    expect(startup?.cost).toBeCloseTo((100 + 800 + 250) / 1_000_000 + 1);
    expect(startup?.outputCost).toBeCloseTo(20 + 3 / 100_000);
    expect(startup?.roleCost).toBeGreaterThan(startup?.cost ?? 0);
  });

  it("期間の前に始まったサブエージェント_期間に入る応答は数え起動は数えない", () => {
    const period = parsePeriod("2026-10-10", undefined) as Period;
    const report = aggregate(
      [
        sub("late", [
          line({ id: "b1", at: "2026-10-05T12:00:00.000Z", input: 5 }),
          line({ id: "b2", at: "2026-10-15T12:00:00.000Z", input: 6 }),
        ]),
      ],
      period,
      prices,
    );
    expect(report.launches).toBe(0);
    expect(report.startup).toEqual([]);
    expect(report.rows[0]?.responses).toBe(1);
  });
});

describe("aggregate のメイン", () => {
  it("メインの応答がある_1リクエストあたりの読み込み量とセッションごとの分布が計算され識別子が出ない", () => {
    const idMarker = "識別子の目印-session-0000";
    const report = aggregate(
      [
        main(
          [
            line({ id: `${idMarker}-a1`, input: 10, cacheWrite: 90, cacheRead: 900 }),
            line({ id: `${idMarker}-a2`, input: 10, cacheWrite: 0, cacheRead: 990 }),
          ],
          1,
        ),
        main([line({ id: `${idMarker}-b1`, input: 0, cacheWrite: 1_000, cacheRead: 0 })], 2),
        main(
          [
            line({ id: `${idMarker}-c1`, cacheRead: 3_000 }),
            line({ id: `${idMarker}-c2`, cacheRead: 3_000 }),
            line({ id: `${idMarker}-c3`, cacheRead: 3_000 }),
          ],
          3,
        ),
      ],
      ALL_TIME,
      prices,
    );
    // 読み込み量の合計: (1,000 + 1,000) + 1,000 + 9,000 = 12,000 を、応答 6 件で割る
    expect(report.main?.responses).toBe(6);
    expect(report.main?.avgRead).toBe(2_000);
    // キャッシュ読み込み: 900 + 990 + 0 + 9,000 = 10,890
    expect(report.main?.cacheReadShare).toBeCloseTo(10_890 / 12_000);
    expect(report.main?.requests).toEqual({ min: 1, median: 2, max: 3 });
    expect(report.main?.avgReadBySession).toEqual({ min: 1_000, median: 1_000, max: 3_000 });
    expect(report.mainSessions).toBe(3);
    const text = formatCostReport(report, prices);
    expect(text).toContain("1 リクエストあたりの平均の読み込み量");
    expect(text).not.toContain(idMarker);
  });

  it("セッションが偶数件_中央は真ん中の2件の平均になる", () => {
    const report = aggregate(
      [main([line({ id: "a1", cacheRead: 100 })], 1), main([line({ id: "b1", cacheRead: 300 })], 2)],
      ALL_TIME,
      prices,
    );
    expect(report.main?.avgReadBySession.median).toBe(200);
  });
});

describe("費用の計算", () => {
  it("5種類のトークンがある_単価を掛けた合計になる", () => {
    const usage = {
      input: 1_000_000,
      cacheWrite5m: 1_000_000,
      cacheWrite1h: 1_000_000,
      cacheRead: 2_000_000,
      output: 100_000,
    };
    const cost = responseCost(prices, "claude-test-a", usage);
    expect(cost?.inputSide).toBeCloseTo(1 + 2 + 4 + 1);
    expect(cost?.output).toBeCloseTo(1);
  });

  it("単価表にないモデル_費用が出ず単価なしと数えられトークンと件数は出る", () => {
    const report = aggregate(
      [
        main([
          line({ id: "a1", model: "claude-test-x", input: 5, output: 7 }),
          line({ id: "a2", model: "claude-test-a", output: 1_000_000 }),
        ]),
      ],
      ALL_TIME,
      prices,
    );
    const unknown = report.rows.find((r) => r.model === "claude-test-x");
    expect(unknown).toMatchObject({ cost: null, responses: 1, tokens: { input: 5, output: 7 } });
    expect(report.unpricedResponses).toBe(1);
    expect(report.mainCost).toBeCloseTo(10);
    const text = formatCostReport(report, prices);
    expect(text).toContain(`| ${MAIN_LABEL} | claude-test-x | - | 1 | 5 |`);
    expect(text).toMatch(/\| claude-test-x .*\| 単価なし \|/);
    expect(text).toContain("単価なしのモデルの応答: 1 件");
  });

  it("入力が上限ちょうどと上限を超える応答_超えるときだけ高い単価になる", () => {
    const atLimit = responseCost(prices, "claude-test-b", {
      input: 1_000_000,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      cacheRead: 0,
      output: 0,
    });
    const over = responseCost(prices, "claude-test-b", {
      input: 600_000,
      cacheWrite5m: 200_000,
      cacheWrite1h: 100_000,
      cacheRead: 100_001,
      output: 1_000_000,
    });
    expect(atLimit?.inputSide).toBeCloseTo(1);
    expect(over?.inputSide).toBeCloseTo((1_000_001 * 2) / 1_000_000);
    expect(over?.output).toBeCloseTo(2);
  });
});

describe("期間", () => {
  it("期間を指定_期間に入る応答だけが数えられる", () => {
    const period = parsePeriod("2026-10-10", "2026-10-20") as Period;
    const report = aggregate(
      [
        main([
          line({ id: "a0", at: "2026-10-05T12:00:00.000Z" }),
          line({ id: "a1", at: "2026-10-15T12:00:00.000Z" }),
          line({ id: "a2", at: "2026-10-25T12:00:00.000Z" }),
        ]),
        main([line({ id: "b0", at: "2026-09-01T12:00:00.000Z" })], 2),
      ],
      period,
      prices,
    );
    expect(report.main?.responses).toBe(1);
    expect(report.mainSessions).toBe(1);
  });

  it("実在しない日付・形の違う日付・始まりが終わりより後_読み取れない", () => {
    expect(parsePeriod("2026-02-30", undefined)).toBeNull();
    expect(parsePeriod("2026/10/01", undefined)).toBeNull();
    expect(parsePeriod(undefined, "10-01")).toBeNull();
    expect(parsePeriod("2026-10-20", "2026-10-10")).toBeNull();
    expect(parsePeriod(undefined, undefined)).toMatchObject({ since: null, until: null, sinceMs: null, untilMs: null });
  });

  it("同じ日を始まりと終わりに指定_その日の1日分になる", () => {
    const p = parsePeriod("2026-10-10", "2026-10-10") as Period;
    expect((p.untilMs ?? 0) - (p.sinceMs ?? 0)).toBeGreaterThanOrEqual(23 * 3_600_000);
    expect((p.untilMs ?? 0) - (p.sinceMs ?? 0)).toBeLessThanOrEqual(25 * 3_600_000);
  });
});

describe("出力", () => {
  it("本文と説明文を含む記録_出力に記録の本文・識別子・説明文・エージェントの種類以外の項目が出ない", () => {
    const report = aggregate(
      [
        main([line({ id: "msg-識別子の目印", output: 1 })]),
        sub("verifier", [line({ id: "msg-識別子の目印-2", output: 1 })]),
      ],
      ALL_TIME,
      prices,
    );
    const text = formatCostReport(report, prices) + skippedNote(report);
    for (const forbidden of [BODY_MARKER, "識別子の目印"]) expect(text).not.toContain(forbidden);
    expect(text).toContain("verifier");
    expect(text).toContain("費用は、トークン数に API の単価を掛けた見積もりで、請求額ではない");
    expect(text).toContain("確かめた日: 2026-01-01");
  });

  it("記録がない_各節に記録なしと出して終わる", () => {
    const text = formatCostReport(aggregate([], ALL_TIME, prices), prices);
    expect(text).toContain("(期間に記録なし)");
    expect(text).toContain("合計: $0.00");
  });
});

describe("parseAgentType", () => {
  it("meta.jsonに説明文がある_エージェントの種類だけを取り出す", () => {
    const text = JSON.stringify({ agentType: "inspector", description: BODY_MARKER, other: 1 });
    expect(parseAgentType(text)).toBe("inspector");
  });

  it("agentTypeがない・形が合わない・読めない_不明として扱う", () => {
    expect(parseAgentType(JSON.stringify({ description: BODY_MARKER }))).toBe(UNKNOWN_AGENT);
    expect(parseAgentType(JSON.stringify({ agentType: `${BODY_MARKER} 長い 説明` }))).toBe(UNKNOWN_AGENT);
    expect(parseAgentType("not json")).toBe(UNKNOWN_AGENT);
    expect(parseAgentType("")).toBe(UNKNOWN_AGENT);
  });
});

describe("parsePriceTable", () => {
  it("同梱の単価表_3つのモデルと出典と確かめた日が読める", () => {
    const table = parsePriceTable(
      JSON.parse(readFileSync(new URL("../data/model-prices.json", import.meta.url), "utf8")),
    );
    expect(table?.source).toBe("Anthropic の料金の文書(Pricing)");
    expect(table?.checkedOn).toBe("2026-11-03");
    expect([...(table?.models.keys() ?? [])].sort()).toEqual([
      "claude-haiku-5-5",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ]);
    expect(table?.models.get("claude-haiku-5-5")?.longContext).toMatchObject({
      overTokens: 100_000,
      input: 0.5,
      output: 2.5,
    });
    expect(table?.models.get("claude-opus-5-5")).toMatchObject({
      input: 4,
      cacheWrite5m: 5,
      cacheWrite1h: 8,
      cacheRead: 0.2,
      output: 20,
    });
  });

  it("単価が負・足りない・確かめた日がない_読み取れない", () => {
    const ok = {
      source: "s",
      checkedOn: "2026-01-01",
      unit: "u",
      notes: [],
      models: { m: { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 } },
    };
    expect(parsePriceTable(ok)).not.toBeNull();
    expect(parsePriceTable({ ...ok, models: { m: { ...ok.models.m, input: -1 } } })).toBeNull();
    expect(parsePriceTable({ ...ok, models: { m: { input: 1 } } })).toBeNull();
    expect(parsePriceTable({ ...ok, checkedOn: "昨日" })).toBeNull();
    expect(parsePriceTable({ ...ok, models: { m: { ...ok.models.m, longContext: { input: 1 } } } })).toBeNull();
    expect(parsePriceTable(null)).toBeNull();
  });
});

describe("記録の置き場", () => {
  it("パスに英数字以外がある_英数字以外の1文字ごとにハイフンになる", () => {
    expect(projectDirName("/a/b.c")).toBe("-a-b-c");
    expect(projectDirName("/work/日本語 dir_1")).toBe("-work-----dir-1");
  });

  it("リポジトリと作業ツリーの名前_同じ名前かハイフンが続く名前だけが選ばれ別のプロジェクトは選ばれない", () => {
    const names = [
      "-w-repo",
      "-w-repo--claude-worktrees-v1",
      "-w-repo-wt-wt-v1",
      "-w-wt-v2",
      "-w-wt-v2-packages-app",
      "-w-repo2",
      "-w-other",
      "-w-wt-v22",
    ];
    expect(selectProjectDirs(names, ["/w/repo", "/w/wt-v2"])).toEqual([
      "-w-repo",
      "-w-repo--claude-worktrees-v1",
      "-w-repo-wt-wt-v1",
      "-w-wt-v2",
      "-w-wt-v2-packages-app",
    ]);
  });

  it("CLAUDE_CONFIG_DIRがある_その下のprojectsを、ない_ホームの.claudeの下を使う", () => {
    expect(defaultProjectsRoot({ CLAUDE_CONFIG_DIR: "/cfg/claude/" }, "/home/u")).toBe("/cfg/claude/projects");
    expect(defaultProjectsRoot({ CLAUDE_CONFIG_DIR: "" }, "/home/u")).toBe("/home/u/.claude/projects");
    expect(defaultProjectsRoot({}, "/home/u/")).toBe("/home/u/.claude/projects");
  });

  it("作業ツリーの一覧_最初が主の作業ツリーで全部のパスが取れる", () => {
    const porcelain = [
      "worktree /w/main",
      "HEAD abc",
      "branch refs/heads/main",
      "",
      "worktree /w/wt-1",
      "HEAD def",
      "detached",
      "",
    ].join("\n");
    expect(worktreeRoots(porcelain)).toEqual(["/w/main", "/w/wt-1"]);
  });

  it("記録のファイル名_退避したものとメタ情報は対象にしない", () => {
    expect(SESSION_FILE.test("0123-abcd.jsonl")).toBe(true);
    expect(SESSION_FILE.test("0123-abcd.orphaned-1-xyz.jsonl")).toBe(false);
    expect(SESSION_FILE.test("0123-abcd.jsonl.superseded-1")).toBe(false);
    expect(AGENT_FILE.test("agent-a1b2.jsonl")).toBe(true);
    expect(AGENT_FILE.test("agent-a1b2.meta.json")).toBe(false);
    expect(AGENT_FILE.test("journal.jsonl")).toBe(false);
  });
});
