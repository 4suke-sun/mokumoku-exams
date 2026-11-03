/**
 * 試験コードの変更(旧コード → 新コード)に伴う、DynamoDB の保存済みデータの移行。
 * 項目の SK に旧コードが入っているもの(`<種類>#<旧コード>#…` または `<種類>#<旧コード>`)を、新コードの SK の項目に写し、
 * 旧い項目を消す。項目の中の `examCode` も新コードにする。何度実行しても同じ結果になる(写し終えた項目は対象にならない)。
 * 報告は、種類ごとの件数だけにする(利用者の識別子や値は含めない)。
 */
import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

/** DynamoDB のドキュメントクライアントのうち、使う部分だけ */
export interface Sender {
  send(command: unknown): Promise<unknown>;
}

/** 資格ごとに持つ項目の SK の種類(アプリの `repository.ts` の SK の接頭辞と同じ) */
export const KINDS = ["RESULT", "BOOKMARK", "REVIEW", "DAY", "STAT", "GOAL", "SECTIONS", "NOTEBOOK"] as const;

export type Move = { pk: string; from: string; to: string; kind: string };
export type Plan = { moves: Move[]; counts: Record<string, number>; conflicts: number };

/** SK を、旧コードから新コードのものに直す。対象でなければ null */
export function renameSortKey(
  sk: string,
  mapping: Readonly<Record<string, string>>,
): { to: string; kind: string } | null {
  for (const kind of KINDS) {
    for (const [from, to] of Object.entries(mapping)) {
      const head = `${kind}#${from}`;
      if (sk === head) return { to: `${kind}#${to}`, kind };
      if (sk.startsWith(`${head}#`)) return { to: `${kind}#${to}${sk.slice(head.length)}`, kind };
    }
  }
  return null;
}

type Item = Record<string, unknown>;

/** テーブル全体を読み、写す項目を数える。何も書かない。新コードの SK に項目がすでにあるものは、衝突として数え、写さない。 */
export async function planMigration(
  client: Sender,
  tableName: string,
  mapping: Readonly<Record<string, string>>,
): Promise<Plan> {
  const plan: Plan = { moves: [], counts: Object.fromEntries(KINDS.map((k) => [k, 0])), conflicts: 0 };
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = (await client.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: startKey }))) as {
      Items?: Item[];
      LastEvaluatedKey?: Record<string, unknown>;
    };
    for (const item of page.Items ?? []) {
      const renamed = renameSortKey(String(item.SK), mapping);
      if (!renamed || typeof item.PK !== "string") continue;
      const exists = (await client.send(
        new GetCommand({ TableName: tableName, Key: { PK: item.PK, SK: renamed.to } }),
      )) as { Item?: Item };
      if (exists.Item) {
        plan.conflicts++;
        continue;
      }
      plan.moves.push({ pk: item.PK, from: String(item.SK), to: renamed.to, kind: renamed.kind });
      plan.counts[renamed.kind] = (plan.counts[renamed.kind] ?? 0) + 1;
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return plan;
}

/**
 * 計画の項目を、新コードの SK に写してから、旧い項目を消す。写せなかった項目は、消さない。
 * 書き込みは「その SK に項目がないとき」だけにする(計画のあとに、新コードで書かれた項目を上書きしない)。あれば、衝突として数える。
 */
export async function applyMigration(
  client: Sender,
  tableName: string,
  mapping: Readonly<Record<string, string>>,
  plan: Plan,
): Promise<{ moved: number; conflicts: number }> {
  let moved = 0;
  let conflicts = 0;
  for (const move of plan.moves) {
    const got = (await client.send(new GetCommand({ TableName: tableName, Key: { PK: move.pk, SK: move.from } }))) as {
      Item?: Item;
    };
    if (!got.Item) continue;
    const item: Item = { ...got.Item, SK: move.to };
    if (typeof item.examCode === "string" && Object.hasOwn(mapping, item.examCode))
      item.examCode = mapping[item.examCode];
    try {
      await client.send(
        new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(PK)" }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        conflicts++;
        continue;
      }
      throw error;
    }
    await client.send(new DeleteCommand({ TableName: tableName, Key: { PK: move.pk, SK: move.from } }));
    moved++;
  }
  return { moved, conflicts };
}
