/**
 * Claude Code のセッション記録(jsonl)から、エージェント定義ごと・モデルごとのトークンと費用を集計する。
 * 純粋な関数だけを置く(ファイルの読み書きは scripts/agent-cost.ts)。手順は docs/lessons-workflow.md の「計測」。
 *
 * 読むのは、応答の行の usage・message.id・モデルの ID・時刻・isSidechain と、`.meta.json` のエージェントの種類だけ。
 * 記録の本文(プロンプト、応答、ツールの入出力)、記録のパス、セッションの識別子は、保持しない・出力しない。
 * 応答の行らしくない行は、中身を読まない(JSON として解釈しない)。
 */
import { parseWorktrees } from "./status.ts";

/** 100 万トークンあたりのドルの単価。 */
export interface Price {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface ModelPrice extends Price {
  /** 入力(入力とキャッシュの合計)が overTokens を超えるリクエストの単価。 */
  longContext?: Price & { overTokens: number };
}

export interface PriceTable {
  source: string;
  checkedOn: string;
  unit: string;
  notes: string[];
  models: Map<string, ModelPrice>;
}

/** 1 回の応答のトークン数(キャッシュの書き込みは、5 分と 1 時間を分ける)。 */
export interface Usage {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface Response {
  /** `message.id`。重複を除くためだけに使い、出力しない。 */
  id: string;
  model: string;
  /** 時刻(ミリ秒) */
  at: number;
  usage: Usage;
}

export type LineResult =
  | { kind: "response"; response: Response; sidechain: boolean }
  | { kind: "synthetic"; sidechain: boolean }
  | { kind: "malformed" }
  | { kind: "ignored" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isRate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

// 応答の行らしい行。他の行(ユーザーの入力、ツールの結果など)は、中身を読まない。
const ASSISTANT_LINE = /"type"\s*:\s*"assistant"/;
// 出力にそのまま出すモデルの ID の形(`claude-` で始まる短い ID だけ)。
// 外れる ID(クラウドの識別子の形など)は、環境固有の値を含みうるので、出力に出さず「(その他のモデル)」にまとめる。
const MODEL_ID = /^claude-[a-z0-9][a-z0-9.-]{0,59}$/;
// アカウント ID と同じ長さ以上の数字の並び。`claude-` で始まっていても、含むものは出さない。
const LONG_DIGITS = /[0-9]{12,}/;
/** `claude-` で始まらないモデルの ID をまとめる名前。単価表にないので「単価なし」になる。 */
export const OTHER_MODEL = "(その他のモデル)";
const SYNTHETIC_MODEL = "<synthetic>";

/** `cache_creation` の 5 分・1 時間の内訳を読む。内訳がなければ、`cache_creation_input_tokens` を 5 分の書き込みとして数える。 */
function readCacheWrites(usage: Record<string, unknown>): { m5: number; h1: number } | null {
  const detail = usage.cache_creation;
  if (isObject(detail)) {
    const m5 = detail.ephemeral_5m_input_tokens;
    const h1 = detail.ephemeral_1h_input_tokens;
    if (m5 !== undefined || h1 !== undefined) {
      if ((m5 !== undefined && !isCount(m5)) || (h1 !== undefined && !isCount(h1))) return null;
      return { m5: m5 ?? 0, h1: h1 ?? 0 };
    }
  }
  const total = usage.cache_creation_input_tokens ?? 0;
  return isCount(total) ? { m5: total, h1: 0 } : null;
}

function readUsage(value: unknown): Usage | null {
  if (!isObject(value)) return null;
  const read = value.cache_read_input_tokens ?? 0;
  const writes = readCacheWrites(value);
  if (!isCount(value.input_tokens) || !isCount(value.output_tokens) || !isCount(read) || writes === null) return null;
  return {
    input: value.input_tokens,
    cacheWrite5m: writes.m5,
    cacheWrite1h: writes.h1,
    cacheRead: read,
    output: value.output_tokens,
  };
}

/** 1 行を読む。応答の行(`type: "assistant"`)だけを数え、読めない行は malformed にする。 */
export function parseLine(line: string): LineResult {
  const text = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (text.trim() === "") return { kind: "ignored" };
  if (!text.startsWith("{") || !text.endsWith("}")) return { kind: "malformed" };
  if (!ASSISTANT_LINE.test(text)) return { kind: "ignored" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "malformed" };
  }
  if (!isObject(parsed) || parsed.type !== "assistant") return { kind: "ignored" };
  const sidechain = parsed.isSidechain === true;
  const message = parsed.message;
  if (!isObject(message) || typeof message.model !== "string") return { kind: "malformed" };
  if (message.model === SYNTHETIC_MODEL) return { kind: "synthetic", sidechain };
  const at = typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
  const usage = readUsage(message.usage);
  if (typeof message.id !== "string" || message.id === "") return { kind: "malformed" };
  if (!Number.isFinite(at) || usage === null) return { kind: "malformed" };
  const model = MODEL_ID.test(message.model) && !LONG_DIGITS.test(message.model) ? message.model : OTHER_MODEL;
  return { kind: "response", response: { id: message.id, model, at, usage }, sidechain };
}

/** 1 つの記録ファイル(メインのセッション 1 つ、またはサブエージェント 1 つ)の読み取り結果。 */
export interface Transcript {
  /** `message.id` ごとに 1 件。最初に現れた順 */
  responses: Response[];
  /** 読めない行・必要な項目がない行の数 */
  malformed: number;
  /** モデルが `<synthetic>` の応答の数(集計に入れない) */
  synthetic: number;
}

/**
 * 記録の行を読み、`message.id` ごとに 1 件にまとめる。同じ `message.id` の行が複数あるとき、最初の行の `output_tokens` は
 * 仮の値のことがあるので、`output_tokens` が最大の行の usage を残す(同じ大きさなら最初の行)。時刻と順序は、最初の行のもの。
 * メインの記録は、`isSidechain` が真の行(サブエージェントの分)を除く(`excludeSidechain`)。
 */
export function readTranscript(lines: Iterable<string>, options: { excludeSidechain: boolean }): Transcript {
  const responses: Response[] = [];
  const indexById = new Map<string, number>();
  let malformed = 0;
  let synthetic = 0;
  for (const line of lines) {
    const result = parseLine(line);
    if (result.kind === "malformed") malformed += 1;
    else if (result.kind === "ignored") continue;
    else if (options.excludeSidechain && result.sidechain) continue;
    else if (result.kind === "synthetic") synthetic += 1;
    else {
      const at = indexById.get(result.response.id);
      const kept = at === undefined ? undefined : responses[at];
      if (at === undefined || kept === undefined) {
        indexById.set(result.response.id, responses.length);
        responses.push(result.response);
      } else if (result.response.usage.output > kept.usage.output) {
        responses[at] = { ...kept, usage: result.response.usage };
      }
    }
  }
  return { responses, malformed, synthetic };
}

/** 出力に出すエージェント定義の名前の形。外れるものは「(不明)」にする。 */
const AGENT_TYPE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
export const UNKNOWN_AGENT = "(不明)";
export const MAIN_LABEL = "(メイン)";

/** `.meta.json` から、エージェントの種類(定義の名前)だけを取り出す。説明文など、ほかの項目は読まない。 */
export function parseAgentType(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    if (isObject(value) && typeof value.agentType === "string" && AGENT_TYPE.test(value.agentType)) {
      return value.agentType;
    }
  } catch {
    // 読めない `.meta.json` は、不明として扱う
  }
  return UNKNOWN_AGENT;
}

// --- 単価表 ---

function readPrice(value: unknown): Price | null {
  if (!isObject(value)) return null;
  const { input, cacheWrite5m, cacheWrite1h, cacheRead, output } = value;
  if (![input, cacheWrite5m, cacheWrite1h, cacheRead, output].every(isRate)) return null;
  return { input, cacheWrite5m, cacheWrite1h, cacheRead, output } as Price;
}

/** 単価表(scripts/data/model-prices.json)を読む。形が合わなければ null。 */
export function parsePriceTable(value: unknown): PriceTable | null {
  if (!isObject(value) || !isObject(value.models) || !Array.isArray(value.notes)) return null;
  const { source, checkedOn, unit } = value;
  if (typeof source !== "string" || typeof checkedOn !== "string" || typeof unit !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn) || !value.notes.every((n) => typeof n === "string")) return null;
  const models = new Map<string, ModelPrice>();
  for (const [model, raw] of Object.entries(value.models)) {
    const price = readPrice(raw);
    if (price === null || !isObject(raw)) return null;
    const entry: ModelPrice = { ...price };
    if (raw.longContext !== undefined) {
      const long = readPrice(raw.longContext);
      const over = isObject(raw.longContext) ? raw.longContext.overTokens : undefined;
      if (long === null || !isCount(over)) return null;
      entry.longContext = { ...long, overTokens: over };
    }
    models.set(model, entry);
  }
  return { source, checkedOn, unit, notes: value.notes as string[], models };
}

/** 入力として読んだトークンの合計(入力・キャッシュ書き込み・キャッシュ読み込み)。 */
export const readTokens = (u: Usage): number => u.input + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;

/** 1 回の応答の費用(ドル)。入力の側(入力・キャッシュ)と、出力の側に分ける。単価表にないモデルは null。 */
export function responseCost(
  prices: PriceTable,
  model: string,
  usage: Usage,
): { inputSide: number; output: number } | null {
  const entry = prices.models.get(model);
  if (entry === undefined) return null;
  const rate: Price = entry.longContext && readTokens(usage) > entry.longContext.overTokens ? entry.longContext : entry;
  return {
    inputSide:
      (usage.input * rate.input +
        usage.cacheWrite5m * rate.cacheWrite5m +
        usage.cacheWrite1h * rate.cacheWrite1h +
        usage.cacheRead * rate.cacheRead) /
      1_000_000,
    output: (usage.output * rate.output) / 1_000_000,
  };
}

// --- 期間 ---

export interface Period {
  /** 指定した日付(表示用)。指定がなければ null */
  since: string | null;
  until: string | null;
  /** 期間の始まり(含む)と終わり(含まない)のミリ秒。端末の時刻で、`until` の日の終わりまで含む */
  sinceMs: number | null;
  untilMs: number | null;
}

function dayStart(text: string, plusDays: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return new Date(year, month - 1, day + plusDays).getTime();
}

/** `--since`・`--until`(`YYYY-MM-DD`。どちらもその日を含む)を読む。日付でない、実在しない、始まりが終わりより後なら null。 */
export function parsePeriod(since: string | undefined, until: string | undefined): Period | null {
  const sinceMs = since === undefined ? null : dayStart(since, 0);
  const untilMs = until === undefined ? null : dayStart(until, 1);
  if ((since !== undefined && sinceMs === null) || (until !== undefined && untilMs === null)) return null;
  if (sinceMs !== null && untilMs !== null && untilMs <= sinceMs) return null;
  return { since: since ?? null, until: until ?? null, sinceMs, untilMs };
}

const inPeriod = (at: number, p: Period): boolean =>
  (p.sinceMs === null || at >= p.sinceMs) && (p.untilMs === null || at < p.untilMs);

// --- 記録の置き場 ---

/** Claude Code が、作業ディレクトリのパスから記録の置き場の名前を作る規則: 英数字以外の文字を `-` に置き換える。 */
export function projectDirName(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/** 記録の置き場の親(`CLAUDE_CONFIG_DIR` があればその下、なければホームの `.claude`)の `projects/`。 */
export function defaultProjectsRoot(env: Record<string, string | undefined>, home: string): string {
  const base = env.CLAUDE_CONFIG_DIR;
  return `${base !== undefined && base !== "" ? base.replace(/\/+$/, "") : `${home.replace(/\/+$/, "")}/.claude`}/projects`;
}

/** `git worktree list --porcelain` から、作業ツリーのパスを取り出す。最初が主の作業ツリー(リポジトリのルート)。 */
export function worktreeRoots(porcelain: string): string[] {
  return parseWorktrees(porcelain).map((w) => w.path);
}

/**
 * 置き場の名前から、対象のものを選ぶ。リポジトリのルートと各作業ツリーのパスを変換した名前と同じか、
 * その名前に `-` が続くもの(作業ツリーや、サブディレクトリで動かしたセッションの置き場)。英数字が続く別の名前(別のプロジェクト)は選ばない。
 */
export function selectProjectDirs(names: string[], roots: string[]): string[] {
  const prefixes = roots.map(projectDirName);
  return names.filter((n) => prefixes.some((p) => n === p || n.startsWith(`${p}-`))).sort();
}

/** メインのセッションの記録(`<セッションID>.jsonl`)の名前。`.orphaned-…`・`.superseded-…` などの退避したものは含めない。 */
export const SESSION_FILE = /^[A-Za-z0-9_-]+\.jsonl$/;
/** サブエージェントの記録の名前。同名の `.meta.json` が、エージェントの種類を持つ。 */
export const AGENT_FILE = /^agent-[A-Za-z0-9_-]+\.jsonl$/;

// --- 集計 ---

export interface TranscriptInput {
  kind: "main" | "subagent";
  /** サブエージェントの定義の名前。メインは null */
  agent: string | null;
  /** 同じセッションの記録を結ぶ連番(識別子ではない)。出力しない */
  session: number;
  transcript: Transcript;
}

export interface Row {
  /** エージェント定義の名前。メインは MAIN_LABEL */
  agent: string;
  model: string;
  /** 最初の応答のモデルがこれで、最初の応答が期間に入るサブエージェントの数。メインは 0 */
  launches: number;
  responses: number;
  tokens: Usage;
  /** 費用(ドル)。単価表にないモデルは null(「単価なし」) */
  cost: number | null;
}

export interface StartupRow {
  agent: string;
  launches: number;
  /** 最初の応答で読んだトークンの合計(入力・キャッシュ書き込み・キャッシュ読み込み) */
  tokens: number;
  /** その入力の費用。単価なしのモデルの起動は含まない */
  cost: number;
  /** 最初の応答の出力の費用(比較のため、入力の費用と分けて持つ) */
  outputCost: number;
  /** 役の費用(単価のあるモデルの分) */
  roleCost: number;
  /** 単価なしのモデルの応答を含む(割合は、単価のある分だけで出す) */
  partial: boolean;
}

export interface Distribution {
  min: number;
  median: number;
  max: number;
}

export interface MainStats {
  responses: number;
  /** 1 リクエストあたりの平均の読み込み量(入力・キャッシュ書き込み・キャッシュ読み込みの合計) */
  avgRead: number;
  /** 読み込み量のうち、キャッシュ読み込みの割合 */
  cacheReadShare: number;
  /** セッションごとのリクエスト数の分布 */
  requests: Distribution;
  /** セッションごとの、1 リクエストあたりの平均の読み込み量の分布 */
  avgReadBySession: Distribution;
}

export interface CostReport {
  period: Period;
  /** 期間に応答のあるメインのセッションの数 */
  mainSessions: number;
  /** 期間に応答のあるサブエージェントを使ったセッションの数 */
  sessionsWithSubagents: number;
  /** 最初の応答が期間に入るサブエージェントの数 */
  launches: number;
  malformed: number;
  synthetic: number;
  /** 単価表にないモデルの応答の数(費用に含めない) */
  unpricedResponses: number;
  rows: Row[];
  startup: StartupRow[];
  main: MainStats | null;
  mainCost: number;
  subagentCost: number;
  subagentModels: { model: string; cost: number | null }[];
}

const emptyUsage = (): Usage => ({ input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 });

function addUsage(to: Usage, from: Usage): void {
  to.input += from.input;
  to.cacheWrite5m += from.cacheWrite5m;
  to.cacheWrite1h += from.cacheWrite1h;
  to.cacheRead += from.cacheRead;
  to.output += from.output;
}

function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { min: sorted[0] ?? 0, median: Math.round(median), max: sorted[sorted.length - 1] ?? 0 };
}

/** 記録を、エージェント定義ごと・モデルごとに集計する。 */
export function aggregate(inputs: TranscriptInput[], period: Period, prices: PriceTable): CostReport {
  interface Acc extends Row {
    sum: number;
  }
  const rows = new Map<string, Acc>();
  const startups = new Map<string, { launches: number; tokens: number; cost: number; outputCost: number }>();
  const mainSessionStats: { requests: number; read: number }[] = [];
  const subagentSessions = new Set<number>();
  const mainTotal = emptyUsage();
  let mainResponses = 0;
  let launches = 0;
  let malformed = 0;
  let synthetic = 0;
  let unpricedResponses = 0;

  const rowOf = (agent: string, model: string): Acc => {
    const key = `${agent}\u0000${model}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = { agent, model, launches: 0, responses: 0, tokens: emptyUsage(), cost: null, sum: 0 };
      rows.set(key, row);
    }
    return row;
  };

  for (const input of inputs) {
    malformed += input.transcript.malformed;
    synthetic += input.transcript.synthetic;
    const agent = input.kind === "main" ? MAIN_LABEL : (input.agent ?? UNKNOWN_AGENT);
    const inside = input.transcript.responses.filter((r) => inPeriod(r.at, period));
    // 期間に応答がなければ、起動も数えない(最初の応答も、期間の外)
    if (inside.length === 0) continue;
    for (const r of inside) {
      const row = rowOf(agent, r.model);
      row.responses += 1;
      addUsage(row.tokens, r.usage);
      const cost = responseCost(prices, r.model, r.usage);
      if (cost === null) unpricedResponses += 1;
      else row.sum += cost.inputSide + cost.output;
    }
    if (input.kind === "main") {
      mainResponses += inside.length;
      let read = 0;
      for (const r of inside) {
        addUsage(mainTotal, r.usage);
        read += readTokens(r.usage);
      }
      mainSessionStats.push({ requests: inside.length, read });
      continue;
    }
    subagentSessions.add(input.session);
    const first = input.transcript.responses[0];
    if (first === undefined || !inPeriod(first.at, period)) continue;
    launches += 1;
    rowOf(agent, first.model).launches += 1;
    const startup = startups.get(agent) ?? { launches: 0, tokens: 0, cost: 0, outputCost: 0 };
    const firstCost = responseCost(prices, first.model, first.usage);
    startup.launches += 1;
    startup.tokens += readTokens(first.usage);
    startup.cost += firstCost?.inputSide ?? 0;
    startup.outputCost += firstCost?.output ?? 0;
    startups.set(agent, startup);
  }

  const finished: Row[] = [...rows.values()].map(({ sum, ...row }) => ({
    ...row,
    cost: prices.models.has(row.model) ? sum : null,
  }));
  finished.sort(
    (a, b) =>
      (b.cost ?? -1) - (a.cost ?? -1) ||
      readTokens(b.tokens) - readTokens(a.tokens) ||
      a.agent.localeCompare(b.agent) ||
      a.model.localeCompare(b.model),
  );

  const roleCost = new Map<string, { cost: number; partial: boolean }>();
  for (const row of finished) {
    if (row.agent === MAIN_LABEL) continue;
    const role = roleCost.get(row.agent) ?? { cost: 0, partial: false };
    role.cost += row.cost ?? 0;
    role.partial = role.partial || row.cost === null;
    roleCost.set(row.agent, role);
  }
  const startup: StartupRow[] = [...startups]
    .map(([agent, s]) => ({
      agent,
      launches: s.launches,
      tokens: s.tokens,
      cost: s.cost,
      outputCost: s.outputCost,
      roleCost: roleCost.get(agent)?.cost ?? 0,
      partial: roleCost.get(agent)?.partial ?? false,
    }))
    .sort((a, b) => b.cost - a.cost || a.agent.localeCompare(b.agent));

  const costOfMain = finished.filter((r) => r.agent === MAIN_LABEL).reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const byModel = new Map<string, number | null>();
  for (const row of finished) {
    if (row.agent === MAIN_LABEL) continue;
    byModel.set(row.model, row.cost === null ? null : (byModel.get(row.model) ?? 0) + row.cost);
  }
  const subagentModels = [...byModel]
    .map(([model, cost]) => ({ model, cost }))
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || a.model.localeCompare(b.model));

  const mainRead = readTokens(mainTotal);
  return {
    period,
    mainSessions: mainSessionStats.length,
    sessionsWithSubagents: subagentSessions.size,
    launches,
    malformed,
    synthetic,
    unpricedResponses,
    rows: finished,
    startup,
    main:
      mainResponses === 0
        ? null
        : {
            responses: mainResponses,
            avgRead: Math.round(mainRead / mainResponses),
            cacheReadShare: mainRead === 0 ? 0 : mainTotal.cacheRead / mainRead,
            requests: distribution(mainSessionStats.map((s) => s.requests)),
            avgReadBySession: distribution(mainSessionStats.map((s) => Math.round(s.read / s.requests))),
          },
    mainCost: costOfMain,
    subagentCost: subagentModels.reduce((sum, m) => sum + (m.cost ?? 0), 0),
    subagentModels,
  };
}

// --- 整形 ---

const num = (n: number): string => n.toLocaleString("en-US");
const usd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (part: number, whole: number): string => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "-");
const NO_PRICE = "単価なし";

function periodText(p: Period): string {
  if (p.since === null && p.until === null) return "指定なし(記録のすべて)";
  return `${p.since ?? "最初"} から ${p.until ?? "最後"} まで(日付は端末の時刻。どちらもその日を含む)`;
}

/** 標準エラーに書く、飛ばした行の件数。なければ空。件数だけで、行の中身は書かない。 */
export function skippedNote(report: CostReport): string {
  return report.malformed === 0 ? "" : `読めない行・必要な項目がない行を ${num(report.malformed)} 件飛ばしました\n`;
}

export function formatCostReport(report: CostReport, prices: PriceTable): string {
  const total = report.mainCost + report.subagentCost;
  const lines: string[] = [
    "## 対象",
    `- 期間: ${periodText(report.period)}`,
    `- メインのセッション: ${num(report.mainSessions)} 件(うちサブエージェントを使った ${num(report.sessionsWithSubagents)} 件)`,
    `- サブエージェントの起動: ${num(report.launches)} 件(最初の応答が期間に入るもの)`,
    `- 除いた応答: モデルが \`<synthetic>\` のもの ${num(report.synthetic)} 件`,
    "",
    "## 費用の内訳(API 換算の見積もり)",
    `- 合計: ${usd(total)}`,
    `- メイン: ${usd(report.mainCost)}(${pct(report.mainCost, total)})`,
    `- サブエージェント: ${usd(report.subagentCost)}(${pct(report.subagentCost, total)})`,
  ];
  if (report.unpricedResponses > 0) {
    lines.push(
      `- ${NO_PRICE}のモデルの応答: ${num(report.unpricedResponses)} 件(費用に含めない。トークンと件数だけを出す)`,
    );
  }

  lines.push("", "## メイン");
  if (report.main === null) {
    lines.push("(期間に記録なし)");
  } else {
    const m = report.main;
    lines.push(
      `- 応答: ${num(m.responses)} 件`,
      `- 1 リクエストあたりの平均の読み込み量(入力・キャッシュ書き込み・キャッシュ読み込みの合計): ${num(m.avgRead)} トークン`,
      `- そのうちキャッシュ読み込み: ${(m.cacheReadShare * 100).toFixed(1)}%`,
      "- セッションごとの分布(最小 / 中央 / 最大)",
      `  - リクエスト数: ${num(m.requests.min)} / ${num(m.requests.median)} / ${num(m.requests.max)}`,
      `  - 1 リクエストあたりの平均の読み込み量: ${num(m.avgReadBySession.min)} / ${num(m.avgReadBySession.median)} / ${num(m.avgReadBySession.max)}`,
    );
  }

  lines.push("", "## エージェント定義ごと・モデルごと");
  if (report.rows.length === 0) {
    lines.push("(期間に記録なし)");
  } else {
    lines.push(
      "| エージェント | モデル | 起動 | 応答 | 入力 | キャッシュ書き込み(5 分) | キャッシュ書き込み(1 時間) | キャッシュ読み込み | 出力 | 費用 |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const r of report.rows) {
      const launches = r.agent === MAIN_LABEL ? "-" : num(r.launches);
      const t = r.tokens;
      lines.push(
        `| ${r.agent} | ${r.model} | ${launches} | ${num(r.responses)} | ${num(t.input)} | ${num(t.cacheWrite5m)} | ${num(t.cacheWrite1h)} | ${num(t.cacheRead)} | ${num(t.output)} | ${r.cost === null ? NO_PRICE : usd(r.cost)} |`,
      );
    }
  }

  lines.push(
    "",
    "## 起動分(各サブエージェントの最初の応答で読む入力。入力・キャッシュ書き込み・キャッシュ読み込みの合計)",
  );
  if (report.startup.length === 0) {
    lines.push("(期間に記録なし)");
  } else {
    lines.push(
      "| エージェント | 起動 | 入力のトークン | 1 回あたりの平均 | 起動分の費用 | 役の費用 | 役の費用に占める割合 | 最初の応答の出力まで含めた割合 |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const s of report.startup) {
      lines.push(
        `| ${s.agent} | ${num(s.launches)} | ${num(s.tokens)} | ${num(Math.round(s.tokens / s.launches))} | ${usd(s.cost)} | ${usd(s.roleCost)}${s.partial ? "(一部単価なし)" : ""} | ${pct(s.cost, s.roleCost)} | ${pct(s.cost + s.outputCost, s.roleCost)} |`,
      );
    }
    const all = report.startup.reduce(
      (sum, s) => ({
        launches: sum.launches + s.launches,
        tokens: sum.tokens + s.tokens,
        cost: sum.cost + s.cost,
        outputCost: sum.outputCost + s.outputCost,
        roleCost: sum.roleCost + s.roleCost,
      }),
      { launches: 0, tokens: 0, cost: 0, outputCost: 0, roleCost: 0 },
    );
    lines.push(
      `| 全体 | ${num(all.launches)} | ${num(all.tokens)} | ${num(Math.round(all.tokens / all.launches))} | ${usd(all.cost)} | ${usd(all.roleCost)} | ${pct(all.cost, all.roleCost)} | ${pct(all.cost + all.outputCost, all.roleCost)} |`,
      "",
      `- サブエージェント全体の費用(${usd(report.subagentCost)})に占める起動分: ${pct(all.cost, report.subagentCost)}(最初の応答の出力まで含めると ${pct(all.cost + all.outputCost, report.subagentCost)})`,
    );
  }

  lines.push("", "## サブエージェントの費用のモデル別");
  if (report.subagentModels.length === 0) lines.push("(期間に記録なし)");
  for (const m of report.subagentModels) {
    lines.push(`- ${m.model}: ${m.cost === null ? NO_PRICE : `${usd(m.cost)}(${pct(m.cost, report.subagentCost)})`}`);
  }

  lines.push(
    "",
    "## 注記",
    "- 費用は、トークン数に API の単価を掛けた見積もりで、請求額ではない。",
    `- 単価表: ${prices.source}(確かめた日: ${prices.checkedOn}。${prices.unit})。有効な期間は持たず、いまの単価で見る。`,
    "- 起動は、最初の応答が期間に入るサブエージェントの数。応答は、期間に入るものだけを数える。",
  );
  return `${lines.join("\n")}\n`;
}
