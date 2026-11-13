#!/usr/bin/env node
/**
 * 手元の計測の集計と記録。手順は docs/lessons-workflow.md の「計測」。
 *   node scripts/metrics.ts                              集計を表示する
 *   node scripts/metrics.ts agent <役> <ミリ秒> <トークン>   サブエージェント 1 回分の所要時間とトークンを足す
 *                                                        (下限は 1000 ミリ秒・100 トークン。下回る値は記録せず、終了コード 2)
 *   node scripts/metrics.ts undo                         最後に足したサブエージェントの記録を 1 件消す
 * `npm run verify` の段階ごとの時間は、実行のたびに自動で記録される。記録は `.git` の共有領域にあり、リポジトリには入らない。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ledgerPath, readLedger } from "./lib/inspection-ledger.ts";
import { inboxPath, parseInbox, summarize } from "./lib/lessons-inbox.ts";
import {
  AGENT_MIN_MS,
  AGENT_MIN_TOKENS,
  AGENT_NAME,
  formatReport,
  metricsPath,
  parseCount,
  parseMetrics,
  removeLastAgent,
  serializeMetric,
  summarizeAgents,
  summarizeLedger,
  summarizeVerify,
} from "./lib/metrics.ts";

const [command, name, ms, tokens] = process.argv.slice(2);

try {
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const path = metricsPath(common);

  if (command === "agent") {
    const msNum = parseCount(ms);
    const tokenNum = parseCount(tokens);
    if (
      !name ||
      !AGENT_NAME.test(name) ||
      msNum === null ||
      tokenNum === null ||
      msNum < AGENT_MIN_MS ||
      tokenNum < AGENT_MIN_TOKENS
    ) {
      process.stderr.write(
        `使い方: node scripts/metrics.ts agent <役の名前> <ミリ秒> <トークン>(実測の値。下限は ${AGENT_MIN_MS} ミリ秒、${AGENT_MIN_TOKENS} トークン)\n`,
      );
      process.exitCode = 2;
    } else {
      appendFileSync(
        path,
        serializeMetric({ type: "agent", at: new Date().toISOString(), name, ms: msNum, tokens: tokenNum }),
      );
      process.stdout.write(`記録しました(${name})\n`);
    }
  } else if (command === "undo" && name === undefined) {
    const { text, removed } = removeLastAgent(existsSync(path) ? readFileSync(path, "utf8") : "");
    if (removed === null) {
      process.stdout.write("消せるサブエージェントの記録はありません\n");
    } else {
      writeFileSync(path, text);
      process.stdout.write(`最後のサブエージェントの記録を消しました(${removed || "名前なし"})\n`);
    }
  } else if (command === undefined) {
    const records = existsSync(path) ? parseMetrics(readFileSync(path, "utf8")) : [];
    const inbox = existsSync(inboxPath(common)) ? parseInbox(readFileSync(inboxPath(common), "utf8")) : [];
    process.stdout.write(
      formatReport({
        verify: summarizeVerify(records),
        agents: summarizeAgents(records),
        ledger: summarizeLedger(readLedger(ledgerPath(common))),
        inbox: summarize(inbox),
      }),
    );
  } else {
    process.stderr.write("使い方: node scripts/metrics.ts | agent <役> <ミリ秒> <トークン> | undo\n");
    process.exitCode = 2;
  }
} catch {
  process.stderr.write("計測を扱えませんでした(git の実行や読み書きに失敗)。\n");
  process.exitCode = 1;
}
