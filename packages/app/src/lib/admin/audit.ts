import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { DocumentSender } from "@/lib/history/repository.ts";

/** 記録する操作の種類 */
export type AuditAction = "disable-user" | "promote-user";

/**
 * 管理者の操作の記録。`actor` は操作した管理者の `sub`(サーバー側で検証した値)、`target` は対象の Cognito のユーザー名。
 * メールアドレスは入れない。
 */
export type AuditEntry = { at: string; actor: string; target: string; action: AuditAction };

export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

/** DynamoDB のキー。利用者の区画(`USER#{sub}`)とは別の、管理者の操作の区画に置く。 */
export const ADMIN_KEY = "ADMIN";
/** 時刻の順に並ぶ。同じ時刻の別の操作で上書きしないよう、対象を後ろに付ける */
export const auditKey = (entry: Pick<AuditEntry, "at" | "target">) => `AUDIT#${entry.at}#${entry.target}`;

export function createDynamoAuditLog(options: { tableName: string; client: DocumentSender }): AuditLog {
  return {
    async record(entry) {
      await options.client.send(
        new PutCommand({
          TableName: options.tableName,
          Item: { PK: ADMIN_KEY, SK: auditKey(entry), type: "audit", ...entry },
        }),
      );
    },
  };
}

/** 手元の開発とテスト用の、メモリ上の記録。 */
export function createMemoryAuditLog(): AuditLog & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    async record(entry) {
      entries.push({ ...entry });
    },
  };
}

const shared = globalThis as typeof globalThis & { __mokumokuFakeAudit?: ReturnType<typeof createMemoryAuditLog> };
let dynamo: { key: string; log: AuditLog } | undefined;

/**
 * 操作の記録の保存先を選ぶ。本番は履歴と同じ DynamoDB のテーブル。手元の開発だけ、`AUTH_FAKE=1` でメモリ上の代替に
 * 切り替えられる(本番の設定では、この指定があっても使わない)。
 */
export function getAuditLog(env: NodeJS.ProcessEnv = process.env): AuditLog {
  if (env.NODE_ENV !== "production" && env.AUTH_FAKE === "1") {
    shared.__mokumokuFakeAudit ??= createMemoryAuditLog();
    return shared.__mokumokuFakeAudit;
  }
  const { HISTORY_TABLE_NAME: tableName, AWS_REGION: region } = env;
  if (!tableName || !region) throw new Error("記録の設定(HISTORY_TABLE_NAME / AWS_REGION)がありません。");
  const key = `${region}/${tableName}`;
  if (dynamo?.key !== key) {
    dynamo = {
      key,
      log: createDynamoAuditLog({ tableName, client: DynamoDBDocumentClient.from(new DynamoDBClient({ region })) }),
    };
  }
  return dynamo.log;
}
