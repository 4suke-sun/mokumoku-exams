/**
 * デプロイの手順(scripts/deploy.ts)の判定。副作用のない関数にして、フィクスチャで単体テストする。
 * 報告は場所と種類だけ(値は扱わない)。差分は、伏せた出力だけを渡す。
 */
import { createHash } from "node:crypto";
import { isVersion } from "./release-plan.ts";

export type DeployStatus = "ok" | "done" | "skip" | "fail" | "wait";

export interface DeployStep {
  name: string;
  status: DeployStatus;
  note: string;
}

const MARK: Record<DeployStatus, string> = { ok: "成功", done: "済み", skip: "省略", fail: "失敗", wait: "待ち" };

export function formatDeployTable(results: DeployStep[]): string {
  const rows = results.map((r) => `| ${r.name} | ${MARK[r.status]} | ${r.note} |`);
  return ["| 段階 | 結果 | 内容 |", "| --- | --- | --- |", ...rows].join("\n");
}

/** 失敗がない(待ちは、失敗ではない)。 */
export const canContinue = (results: DeployStep[]): boolean => results.every((r) => r.status !== "fail");

export const DEPLOY_COMMAND = "npm run deploy -w @mokumoku-exams/infra -- --all";

/** `vX.Y.Z` の並びで、版の 1 つ前のタグ。ない(最初の版)ときは null。 */
export function previousTag(tags: string[], version: string): string | null {
  const key = (tag: string) => tag.slice(1).split(".").map(Number);
  const compare = (a: string, b: string) => {
    const [x, y] = [key(a), key(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };
  const older = tags.filter((t) => isVersion(t) && compare(t, version) < 0).sort(compare);
  return older.at(-1) ?? null;
}

/**
 * デプロイに影響するパス。CI の `changes` ジョブ(.github/workflows/ci.yml)の区分を参考にするが、同じではない:
 * CI は scripts/ と .github/ の変更でも全ジョブを動かすが、デプロイには影響しない。
 * `data/release-notes.json` は、CI の e2e では除くが、画面に版のタイトルが出るので、デプロイには影響する。
 */
const IMPACT = /^(?:packages\/app\/|packages\/infra\/|packages\/data-schema\/|data\/|[^/]+$)/;

export interface DeployNeed {
  needed: boolean;
  /** 影響するパスの数 */
  count: number;
  /** `data/release-notes.json` だけが影響する(人が省くと選べる) */
  releaseNotesOnly: boolean;
}

export function judgeDeployNeed(changedFiles: string[]): DeployNeed {
  const impacting = changedFiles.filter((f) => IMPACT.test(f));
  return {
    needed: impacting.length > 0,
    count: impacting.length,
    releaseNotesOnly: impacting.length > 0 && impacting.every((f) => f === "data/release-notes.json"),
  };
}

export interface PrerequisiteInput {
  version: string;
  /** タグが指すコミット。タグがなければ null */
  tagCommit: string | null;
  headCommit: string;
  /** リポジトリにある最新のタグ */
  latestTag: string;
  dirty: boolean;
  envFileExists: boolean;
  /** .env が git に追跡されている */
  envTracked: boolean;
  /** AWS の認証の確認。確かめられなかった(CLI がない)ときは null */
  awsAuthorized: boolean | null;
}

/** 前提の確認。失敗の理由の一覧(空なら通る)。 */
export function checkPrerequisites(input: PrerequisiteInput): string[] {
  const errors: string[] = [];
  if (!isVersion(input.version)) errors.push("版が vX.Y.Z の形でない");
  if (input.tagCommit === null) errors.push(`タグ ${input.version} がない(先に /dev-release で版を切る)`);
  else if (input.tagCommit !== input.headCommit) errors.push("作業ツリーの先頭が、版のタグのコミットでない");
  if (input.latestTag !== "" && input.latestTag !== input.version)
    errors.push("版が最新のタグでない(古い版は、前の版のタグを指定した再デプロイとして、人が判断する)");
  if (input.dirty) errors.push("作業ツリーに未コミットの変更がある");
  if (!input.envFileExists) errors.push(".env がない");
  if (input.envTracked) errors.push(".env が git に追跡されている");
  if (input.awsAuthorized === false) errors.push("AWS の認証が使えない");
  return errors;
}

export interface DiffSummary {
  /** 解釈できた(変更の行か、変更なしの表示があった) */
  understood: boolean;
  stacks: string[];
  /** リソースの種類ごとの追加・変更・削除の件数 */
  resources: Record<string, { add: number; change: number; remove: number }>;
  iam: boolean;
  publicSetting: boolean;
  removals: number;
}

const RESOURCE_LINE = /^\s*(?:│\s*)?\[([+~-])\]\s+(AWS::\w+::\w+)\b/;
const STACK_LINE = /^Stack\s+([A-Za-z][A-Za-z0-9-]*)\s*$/;
const NO_DIFF = /There were no differences|no differences/i;
const IAM_MARK = /IAM (?:Statement|Policy) Changes|AWS::IAM::/;
// 公開に関わる設定。CloudFront の配信、Function URL、S3 の公開のブロック、認可の種類
const PUBLIC_MARK = /AWS::CloudFront::Distribution|AWS::Lambda::Url|PublicAccessBlock|AuthType|AWS::S3::BucketPolicy/;

/**
 * 伏せた差分の出力から、要約を作る。結果は、スタック名・リソースの種類・件数・有無だけで、行の本文は持たない
 * (環境変数の値などが、要約に入らない)。
 */
export function summarizeDiff(masked: string): DiffSummary {
  const summary: DiffSummary = {
    understood: false,
    stacks: [],
    resources: {},
    iam: false,
    publicSetting: false,
    removals: 0,
  };
  let current: string | null = null;
  const changedStacks = new Set<string>();
  for (const line of masked.split("\n")) {
    const stack = STACK_LINE.exec(line);
    if (stack) {
      current = stack[1] ?? null;
      continue;
    }
    if (NO_DIFF.test(line)) summary.understood = true;
    if (IAM_MARK.test(line)) summary.iam = true;
    if (PUBLIC_MARK.test(line)) summary.publicSetting = true;
    const resource = RESOURCE_LINE.exec(line);
    if (!resource) continue;
    summary.understood = true;
    if (current) changedStacks.add(current);
    const type = resource[2] ?? "";
    const entry = summary.resources[type] ?? { add: 0, change: 0, remove: 0 };
    if (resource[1] === "+") entry.add++;
    else if (resource[1] === "~") entry.change++;
    else {
      entry.remove++;
      summary.removals++;
    }
    summary.resources[type] = entry;
  }
  summary.stacks = [...changedStacks];
  return summary;
}

/** 差分の段階の結果。形を解釈できないときは、失敗にせず、全文を人が読む待ちにして、関門へ進む。 */
export const diffStepStatus = (summary: DiffSummary): "ok" | "wait" => (summary.understood ? "ok" : "wait");

/** 版の形のタグのうち、最新のもの。版の形でないタグは数えない。ないときは空。 */
export function latestVersionTag(tags: string[]): string {
  const versions = tags.filter(isVersion);
  return versions.reduce(
    (latest, tag) => (previousTag([latest, tag], tag) === latest ? tag : latest),
    versions[0] ?? "",
  );
}

/** 要約を、人に見せる行にする。解釈できなかったときは、全文を読むよう促す。 */
export function formatDiffSummary(summary: DiffSummary): string[] {
  if (!summary.understood) return ["差分の形を解釈できなかった。伏せた全文を読む"];
  const lines: string[] = [];
  lines.push(
    summary.stacks.length === 0 ? "変更のあるスタック: なし" : `変更のあるスタック: ${summary.stacks.join(", ")}`,
  );
  for (const [type, c] of Object.entries(summary.resources)) {
    lines.push(`${type}: 追加 ${c.add} / 変更 ${c.change} / 削除 ${c.remove}`);
  }
  lines.push(`IAM の変更: ${summary.iam ? "あり" : "なし"}`);
  lines.push(`公開に関わる設定の変更: ${summary.publicSetting ? "あり" : "なし"}`);
  lines.push(`削除: ${summary.removals > 0 ? `あり(${summary.removals} 件)` : "なし"}`);
  return lines;
}

/** 差分の全文のハッシュ。表に出して、人が承認した差分と見比べられるようにする。 */
export const diffHash = (masked: string): string => createHash("sha256").update(masked).digest("hex");

/**
 * デプロイ後の画面確認(docs/post-deploy-smoke.md)の「3. 確認する流れ」の表から、項目名を取り出す。
 * 人が確かめる項目の一覧を、文書から作る(スクリプトに写さない)。
 */
export function humanChecklist(doc: string): string[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => /^##\s+3\./.test(l));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.startsWith("|")) continue;
    const cell = line.split("|")[1]?.trim() ?? "";
    if (cell === "" || cell === "項目" || /^-+$/.test(cell)) continue;
    items.push(cell);
  }
  return items;
}
