#!/usr/bin/env node
/**
 * 試験コードの変更に伴う、保存済みデータ(DynamoDB)の移行。既定は確認だけで、何も書かない。`--apply` で実行する。
 *
 *   node scripts/with-env.ts node scripts/migrate-exam-codes.ts            # 件数の確認(書き込みなし)
 *   node scripts/with-env.ts node scripts/migrate-exam-codes.ts --apply    # 移行する
 *
 * 環境変数: HISTORY_TABLE_NAME(履歴のテーブルの名前)、AWS の認証情報とリージョン(.env)。値は出力しない。
 * 旧コードと新コードの対応は、資格マスタ(data/exams.json)の `previousCodes` から読む。
 */
import { readFileSync } from "node:fs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { applyMigration, planMigration } from "./lib/migrate-exam-codes.ts";

const tableName = process.env.HISTORY_TABLE_NAME;
if (!tableName) {
  process.stderr.write("HISTORY_TABLE_NAME が設定されていません。\n");
  process.exit(2);
}

const { exams } = JSON.parse(readFileSync(new URL("../data/exams.json", import.meta.url), "utf8")) as {
  exams: { examCode: string; previousCodes?: string[] }[];
};
const mapping: Record<string, string> = Object.fromEntries(
  exams.flatMap(({ examCode, previousCodes = [] }) => previousCodes.map((old) => [old, examCode] as const)),
);

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const apply = process.argv.includes("--apply");

try {
  const plan = await planMigration(client, tableName, mapping);
  process.stdout.write(`移す項目: ${plan.moves.length} 件(新コードの側に項目がすでにある衝突: ${plan.conflicts} 件)\n`);
  for (const [kind, count] of Object.entries(plan.counts)) process.stdout.write(`  ${kind}: ${count}\n`);
  if (!apply) {
    process.stdout.write("確認だけです。移行するには --apply を付けて、もう一度実行してください。\n");
  } else {
    const { moved, conflicts } = await applyMigration(client, tableName, mapping, plan);
    process.stdout.write(
      `移行しました: ${moved} 件(書き込みの時点で衝突した項目: ${conflicts} 件。旧い項目は残しています)\n`,
    );
  }
} catch {
  // 原因の詳細(テーブルの名前やアカウントを含みうる)は出さない
  process.stderr.write("移行に失敗しました(DynamoDB の読み書きでエラー)。\n");
  process.exit(1);
}
