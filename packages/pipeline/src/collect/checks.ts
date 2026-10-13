import { hostAllowedForVendor, sourceUrlReason } from "../contract.ts";
import type { FetchResult } from "./fetcher.ts";
import { hasDeprecationSignal } from "./html.ts";
import type { CheckName, CheckResult, SourceEntry, SourceStatus } from "./ledger.ts";

/**
 * 一次情報の厳格な検査(docs/source-policy.md の「3. 出典にしてよいもの」)。モデルによる検証より前に置く、安い機械検査。
 * 各検査は pass / fail / unknown を返す。unknown(確認不能)は、fail と同じく先へ進めない。
 * 結果は検査の名前と理由コードだけで、本文や値を含めない。
 */

export interface CheckOutcome {
  name: CheckName;
  result: CheckResult;
  reason?: string;
}

/** 資格マスタのうち、検査に使う項目 */
export interface ExamInfo {
  examCode: string;
  vendor: string;
  edition?: string;
}

export interface CheckInput {
  entry: Pick<SourceEntry, "url" | "target">;
  /** 資格マスタにない資格は null */
  exam: ExamInfo | null;
  /** 計画が対象にするリージョン。指定がなければ制限しない */
  regions?: readonly string[];
  fetched: FetchResult;
  /** 出典が示す更新日。取れなければ null */
  updatedAt: string | null;
  /** 今日の日付(YYYY-MM-DD) */
  today: string;
  freshnessDays: number;
}

const pass = (name: CheckName): CheckOutcome => ({ name, result: "pass" });
const fail = (name: CheckName, reason: string): CheckOutcome => ({ name, result: "fail", reason });
const unknown = (name: CheckName, reason: string): CheckOutcome => ({ name, result: "unknown", reason });

/** 公式か: 許可したドメインで、そのホストを出典にしてよいベンダーが資格のベンダーと一致する。リダイレクトのあとの URL も見る */
export function checkOfficial({ entry, exam, fetched }: CheckInput): CheckOutcome {
  const urls = fetched.ok ? [entry.url, fetched.finalUrl] : [entry.url];
  for (const url of urls) if (sourceUrlReason(url) !== null) return fail("official", "host-not-allowed");
  if (exam === null) return unknown("official", "exam-not-in-master");
  for (const url of urls) {
    if (!hostAllowedForVendor(new URL(url).hostname, exam.vendor)) return fail("official", "vendor-mismatch");
  }
  return pass("official");
}

/** 対象の資格・版・リージョンに該当するか */
export function checkTarget({ entry, exam, regions }: CheckInput): CheckOutcome {
  if (exam === null) return unknown("target", "exam-not-in-master");
  if (entry.target.examCode !== exam.examCode) return fail("target", "exam-mismatch");
  if (entry.target.edition !== undefined) {
    if (exam.edition === undefined) return unknown("target", "edition-unknown");
    if (entry.target.edition !== exam.edition) return fail("target", "edition-mismatch");
  }
  if (entry.target.region !== undefined && regions !== undefined && !regions.includes(entry.target.region)) {
    return fail("target", "region-mismatch");
  }
  return pass("target");
}

/** 廃止・更新の兆候がないか */
export function checkDeprecation({ fetched }: CheckInput): CheckOutcome {
  if (!fetched.ok) {
    return fetched.reason === "http-error" && fetched.status === 410
      ? fail("deprecation", "gone")
      : unknown("deprecation", "no-body");
  }
  return hasDeprecationSignal(fetched.body.toString("utf8"))
    ? fail("deprecation", "deprecation-signal")
    : pass("deprecation");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 日付が新しいか。出典が更新日を示さないときは、取得日で代えて合格にする */
export function checkFreshness({ fetched, updatedAt, today, freshnessDays }: CheckInput): CheckOutcome {
  if (!fetched.ok) return unknown("freshness", "no-body");
  if (updatedAt === null) return pass("freshness");
  const age = (Date.parse(today) - Date.parse(updatedAt)) / DAY_MS;
  if (Number.isNaN(age)) return unknown("freshness", "invalid-date");
  if (age < -1) return unknown("freshness", "future-date");
  if (age > freshnessDays) return fail("freshness", "stale");
  return pass("freshness");
}

/** リンクが生きているか */
export function checkLiveness({ fetched }: CheckInput): CheckOutcome {
  if (fetched.ok) return pass("liveness");
  switch (fetched.reason) {
    case "http-error":
      return fetched.status === 404 || fetched.status === 410
        ? fail("liveness", "dead-link")
        : unknown("liveness", "http-error");
    case "not-allowed":
      return fail("liveness", "redirect-not-allowed");
    default:
      return unknown("liveness", fetched.reason);
  }
}

export function runChecks(input: CheckInput): CheckOutcome[] {
  return [checkOfficial, checkTarget, checkDeprecation, checkFreshness, checkLiveness].map((check) => check(input));
}

/**
 * 検査の結果から、台帳の状態を決める。すべて合格なら active。
 * 廃止の兆候は deprecated、リンクが確かめられないものは unreachable、ほかの不合格・確認不能は needs-review。
 */
export function statusFromChecks(outcomes: readonly CheckOutcome[]): SourceStatus {
  if (outcomes.every((o) => o.result === "pass")) return "active";
  const of = (name: CheckName) => outcomes.find((o) => o.name === name);
  if (of("deprecation")?.result === "fail") return "deprecated";
  if (of("liveness")?.result !== "pass") return "unreachable";
  return "needs-review";
}
