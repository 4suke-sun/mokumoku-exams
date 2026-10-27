import { resolve } from "node:path";
import { BodyCache } from "../collect/cache.ts";
import type { CollectDeps } from "../collect/collect.ts";
import { contentHashOf } from "../collect/content-hash.ts";
import { LedgerError, ledgerPath, parseLedger, readLedger, writeLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import {
  DecisionsError,
  decisionsPath,
  parseDecisions,
  readDecisions,
  writeDecisions,
} from "../decisions/decisions.ts";
import {
  ProvenanceError,
  parseProvenance,
  provenancePath,
  readProvenance,
  writeProvenance,
} from "../draft/provenance.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, factsPath, parseFacts, readFacts, writeFacts } from "../facts/schema.ts";
import { type Kind, type Output, report } from "../log.ts";
import { PathsError } from "../shared/errors.ts";
import { prepareExam } from "../shared/exam.ts";
import { currentPairs, type HashedFiles, hashPairs, remapHashes } from "./remap.ts";

/**
 * rehash コマンド(ADR 0025): 出典の本文のハッシュの定義を変えたとき、保存済みのハッシュを新しい定義へ移す。
 * キャッシュの本文から新しいハッシュを計算し、台帳・事実カード・来歴・判断の記録を、再検証の印を付けずに書き換える。
 * 何度流しても、同じ結果になる(新しい定義のハッシュは、計算し直しても変わらない)。
 */

export interface RehashOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  /** 本文がキャッシュにない現在のハッシュを、取り直して新しい定義のハッシュにする */
  refetch: boolean;
  dryRun: boolean;
  output: Output;
  deps: CollectDeps;
}

/** 書き換えたあとの記録が、どれも検査を通ることを確かめる(1 つでも通らなければ、何も書かない) */
function invalidKinds(files: HashedFiles): { kind: Kind; paths: string[] }[] {
  const checks: [Kind, () => unknown][] = [
    ["台帳の誤り", () => parseLedger(files.ledger)],
    ["事実カードの誤り", () => parseFacts(files.facts)],
    ["来歴の誤り", () => parseProvenance(files.provenance)],
    ["判断の記録の誤り", () => parseDecisions(files.decisions)],
  ];
  const problems: { kind: Kind; paths: string[] }[] = [];
  for (const [kind, check] of checks) {
    try {
      check();
    } catch (error) {
      if (!(error instanceof PathsError)) throw error;
      problems.push({ kind, paths: error.paths });
    }
  }
  return problems;
}

function load(options: RehashOptions): { files: HashedFiles; paths: Record<keyof HashedFiles, string> } | ExitCode {
  const { config, rootDir, examCode, output } = options;
  const paths = {
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    provenance: provenancePath(resolve(rootDir, config.provenanceDir), examCode),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
  };
  try {
    return {
      paths,
      files: {
        ledger: readLedger(paths.ledger, examCode),
        facts: readFacts(paths.facts, examCode),
        provenance: readProvenance(paths.provenance, examCode),
        decisions: readDecisions(paths.decisions, examCode),
      },
    };
  } catch (error) {
    const kind =
      error instanceof LedgerError
        ? "台帳の誤り"
        : error instanceof FactsError
          ? "事実カードの誤り"
          : error instanceof ProvenanceError
            ? "来歴の誤り"
            : error instanceof DecisionsError
              ? "判断の記録の誤り"
              : null;
    if (kind === null) throw error;
    for (const p of (error as { paths: string[] }).paths) report(output, kind, p);
    return EXIT.checkFailed;
  }
}

export async function runRehash(options: RehashOptions): Promise<ExitCode> {
  const { config, rootDir, output, deps, dryRun, refetch } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const loaded = load(options);
  if (typeof loaded === "number") return loaded;
  const { files, paths } = loaded;

  const cache = new BodyCache(resolve(rootDir, config.workDir, "cache"), config.cache, deps.now);
  const current = new Set(currentPairs(files.ledger).map((p) => `${p.url} ${p.hash}`));
  const resolved = new Map<string, string>();
  let converted = 0;
  let unchanged = 0;
  let refetched = 0;
  let staleMissing = 0;
  const pending: string[] = [];
  // 新しい名前でキャッシュに置く本文。記録の検査を通ったあとで書く
  const toCache: Buffer[] = [];

  for (const { url, hash } of hashPairs(files)) {
    const key = `${url} ${hash}`;
    const body = cache.peek(hash);
    if (body !== null) {
      const next = contentHashOf(body);
      if (next === hash) {
        unchanged++;
      } else {
        resolved.set(key, next);
        converted++;
        toCache.push(body);
      }
      continue;
    }
    // 本文がない。今の本文のハッシュだけ、取り直して採用できる(古い根拠のハッシュは、今の本文に寄せない)
    if (!current.has(key)) {
      staleMissing++;
      continue;
    }
    if (!refetch || dryRun) {
      pending.push(url);
      continue;
    }
    const fetched = await deps.fetcher.get(url);
    if (!fetched.ok) {
      pending.push(url);
      continue;
    }
    toCache.push(fetched.body);
    resolved.set(key, fetched.hash);
    refetched++;
  }

  const next = remapHashes(files, (url, hash) => resolved.get(`${url} ${hash}`) ?? hash);
  const invalid = invalidKinds(next);
  if (invalid.length > 0) {
    for (const { kind, paths: where } of invalid) for (const p of where) report(output, kind, p);
    report(output, "ハッシュの移行", "書き換えたあとの記録が検査を通らないので、何も書かない");
    return EXIT.checkFailed;
  }
  const changedFiles = (Object.keys(files) as (keyof HashedFiles)[]).filter(
    (k) => JSON.stringify(files[k]) !== JSON.stringify(next[k]),
  );
  report(
    output,
    "ハッシュの移行",
    `変換 ${converted} 件、変更なし ${unchanged} 件、取り直して採用 ${refetched} 件、本文がなく古い根拠のため据え置き ${staleMissing} 件`,
  );
  for (const url of pending) report(output, "ハッシュの移行の保留", url);
  if (dryRun) {
    report(
      output,
      "ハッシュの移行",
      `書き換える記録 ${changedFiles.length} 件、本文がなく移せない現在の出典 ${pending.length} 件`,
    );
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  for (const body of toCache) cache.write(body);
  if (changedFiles.includes("ledger")) writeLedger(paths.ledger, next.ledger);
  if (changedFiles.includes("facts")) writeFacts(paths.facts, next.facts);
  if (changedFiles.includes("provenance")) writeProvenance(paths.provenance, next.provenance);
  if (changedFiles.includes("decisions")) writeDecisions(paths.decisions, next.decisions);
  if (pending.length > 0) {
    report(
      output,
      "ハッシュの移行",
      `本文がなく移せない現在の出典 ${pending.length} 件。--refetch で取り直すと、新しい定義のハッシュを採用する`,
    );
    return EXIT.checkFailed;
  }
  return EXIT.ok;
}
