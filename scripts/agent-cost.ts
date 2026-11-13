#!/usr/bin/env node
/**
 * Claude Code のセッション記録(jsonl)から、エージェント定義ごと・モデルごとのトークンと費用を集計する。手順は docs/lessons-workflow.md の「計測」。
 *   node scripts/agent-cost.ts [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--dir <記録の置き場>]...
 * 既定の記録の置き場は、このリポジトリ(主の作業ツリー)と、各作業ツリーのパスから Claude Code が作る名前の置き場
 * (`$CLAUDE_CONFIG_DIR/projects/` か `~/.claude/projects/` の下)。`--dir` を指定したら、既定は使わない(複数可)。
 * 費用は API の単価からの見積もりで、請求額ではない。出力に、記録の本文・パス・セッションの識別子は出さない。
 * 終了コード: 入力の誤り 2、読み込みの失敗 1。
 */
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parseArgs } from "node:util";
import {
  AGENT_FILE,
  aggregate,
  defaultProjectsRoot,
  formatCostReport,
  parseAgentType,
  parsePeriod,
  parsePriceTable,
  readTranscript,
  SESSION_FILE,
  selectProjectDirs,
  skippedNote,
  type Transcript,
  type TranscriptInput,
  worktreeRoots,
} from "./lib/agent-cost.ts";

const USAGE =
  "使い方: node scripts/agent-cost.ts [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--dir <記録の置き場>]...\n";
const MAX_DEPTH = 4;

/** 読み込みの失敗(記録の置き場が見つからない、読めないなど)。メッセージにパスや記録の内容を含めない。 */
class ReadFailure extends Error {}

/** 1 つのファイルを、1 行ずつ読む。大きい記録でも、メモリを使いすぎないよう、少しずつ読む。 */
function* readLines(path: string): Generator<string> {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    const decoder = new StringDecoder("utf8");
    let pending: string[] = [];
    for (;;) {
      const n = readSync(fd, buffer, 0, buffer.length, null);
      if (n === 0) break;
      const text = decoder.write(buffer.subarray(0, n));
      let start = 0;
      for (;;) {
        const end = text.indexOf("\n", start);
        if (end === -1) break;
        const piece = text.slice(start, end);
        yield pending.length === 0 ? piece : [...pending, piece].join("");
        pending = [];
        start = end + 1;
      }
      if (start < text.length) pending.push(text.slice(start));
    }
    pending.push(decoder.end());
    const rest = pending.join("");
    if (rest !== "") yield rest;
  } finally {
    closeSync(fd);
  }
}

/** `subagents/` の下(`workflows/<名前>/` などの入れ子を含む)のサブエージェントの記録のファイル。 */
function agentFiles(dir: string, depth = 0): string[] {
  if (depth > MAX_DEPTH) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...agentFiles(join(dir, entry.name), depth + 1));
    else if (entry.isFile() && AGENT_FILE.test(entry.name)) found.push(join(dir, entry.name));
  }
  return found;
}

/** 期間の始まりより前に最後に書かれたファイルは、その期間の応答を持たないので読まない。 */
const mayHaveResponses = (path: string, sinceMs: number | null): boolean =>
  sinceMs === null || statSync(path).mtimeMs >= sinceMs;

function resolveDirs(explicit: string[]): string[] {
  if (explicit.length > 0) {
    return explicit.map((d) => {
      const dir = resolve(d);
      if (!existsSync(dir) || !statSync(dir).isDirectory())
        throw new ReadFailure("指定した記録の置き場を読めませんでした");
      return dir;
    });
  }
  const root = defaultProjectsRoot(process.env, homedir());
  let roots: string[];
  try {
    roots = worktreeRoots(
      execFileSync("git", ["worktree", "list", "--porcelain"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    throw new ReadFailure("作業ツリーの一覧を取れませんでした(git の実行に失敗)。--dir で記録の置き場を指定できます");
  }
  const dirs = existsSync(root) ? selectProjectDirs(readdirSync(root), roots).map((n) => join(root, n)) : [];
  if (dirs.length === 0) {
    throw new ReadFailure(
      "このリポジトリの記録が、既定の置き場に見つかりませんでした。--dir で記録の置き場を指定できます",
    );
  }
  return dirs;
}

function main(): number {
  let values: { since?: string; until?: string; dir?: string[] };
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: { since: { type: "string" }, until: { type: "string" }, dir: { type: "string", multiple: true } },
      allowPositionals: false,
    }));
  } catch {
    process.stderr.write(USAGE);
    return 2;
  }
  const period = parsePeriod(values.since, values.until);
  if (period === null) {
    process.stderr.write(
      `--since と --until は、実在する日付を YYYY-MM-DD で、始まりが終わりより後にならないように指定してください。\n${USAGE}`,
    );
    return 2;
  }

  try {
    const prices = parsePriceTable(
      JSON.parse(readFileSync(new URL("./data/model-prices.json", import.meta.url), "utf8")),
    );
    if (prices === null) throw new ReadFailure("単価表の形が合いません");

    const inputs: TranscriptInput[] = [];
    let session = 0;
    for (const dir of resolveDirs(values.dir ?? [])) {
      const entries = readdirSync(dir, { withFileTypes: true });
      const mainIds = entries
        .filter((e) => e.isFile() && SESSION_FILE.test(e.name))
        .map((e) => e.name.replace(/\.jsonl$/, ""));
      const subDirs = entries
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "subagents")))
        .map((e) => e.name);
      for (const id of new Set([...mainIds, ...subDirs])) {
        session += 1;
        const mainFile = join(dir, `${id}.jsonl`);
        if (mainIds.includes(id) && mayHaveResponses(mainFile, period.sinceMs)) {
          const transcript: Transcript = readTranscript(readLines(mainFile), { excludeSidechain: true });
          inputs.push({ kind: "main", agent: null, session, transcript });
        }
        const subDir = join(dir, id, "subagents");
        if (!existsSync(subDir)) continue;
        for (const file of agentFiles(subDir)) {
          if (!mayHaveResponses(file, period.sinceMs)) continue;
          const metaFile = file.replace(/\.jsonl$/, ".meta.json");
          const agent = existsSync(metaFile) ? parseAgentType(readFileSync(metaFile, "utf8")) : parseAgentType("");
          inputs.push({
            kind: "subagent",
            agent,
            session,
            transcript: readTranscript(readLines(file), { excludeSidechain: false }),
          });
        }
      }
    }

    const report = aggregate(inputs, period, prices);
    process.stdout.write(formatCostReport(report, prices));
    process.stderr.write(skippedNote(report));
    return 0;
  } catch (error) {
    process.stderr.write(
      `${error instanceof ReadFailure ? error.message : "記録を読めませんでした(読み込みに失敗)"}\n`,
    );
    return 1;
  }
}

process.exitCode = main();
