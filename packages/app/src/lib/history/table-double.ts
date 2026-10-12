import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { DocumentSender } from "./repository.ts";

/**
 * 更新の式(`SET #a = :a, ... ADD #b :b, ...` の形だけ)を、項目に当てはめる。
 * ADD は、属性がなければ 0 から足す(DynamoDB と同じ)。
 */
function applyUpdate(
  item: Record<string, unknown>,
  expression: string,
  names: Record<string, string>,
  values: Record<string, unknown>,
) {
  const name = (token: string) => names[token] ?? token;
  const set = /SET (.+?)(?= ADD |$)/.exec(expression)?.[1];
  const add = / ?ADD (.+)$/.exec(expression)?.[1];
  for (const part of set?.split(",") ?? []) {
    const [target, value] = part.split("=").map((t) => t.trim());
    if (target && value) item[name(target)] = values[value];
  }
  for (const part of add?.split(",") ?? []) {
    const [target, value] = part.trim().split(/\s+/);
    if (target && value) item[name(target)] = Number(item[name(target)] ?? 0) + Number(values[value]);
  }
}

/** DynamoDB の Put / Get / Update / Query / Delete / Scan だけを、メモリ上で真似る。送られた命令も記録する。 */
/**
 * `scanPageSize` と `queryPageSize` は、スキャンと問い合わせの 1 回で読む数(本物の 1MB ごとのページ分けの代わり)。
 * 開始の項目(ExclusiveStartKey)は、その項目が消えていても、並びの位置から続ける本物とは違い、ある項目だけを扱う。
 */
export function fakeTable(options: { scanPageSize?: number; queryPageSize?: number } = {}) {
  const items = new Map<string, Record<string, unknown>>();
  const sent: unknown[] = [];
  const client: DocumentSender = {
    async send(command) {
      sent.push(command);
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        const old = items.get(`${item.PK}|${item.SK}`);
        items.set(`${item.PK}|${item.SK}`, item);
        return command.input.ReturnValues === "ALL_OLD" && old ? { Attributes: old } : {};
      }
      if (command instanceof GetCommand) {
        const key = command.input.Key as Record<string, string>;
        const item = items.get(`${key.PK}|${key.SK}`);
        return item ? { Item: item } : {};
      }
      if (command instanceof UpdateCommand) {
        const key = command.input.Key as Record<string, string>;
        const item = items.get(`${key.PK}|${key.SK}`) ?? { PK: key.PK, SK: key.SK };
        applyUpdate(
          item,
          command.input.UpdateExpression ?? "",
          command.input.ExpressionAttributeNames ?? {},
          (command.input.ExpressionAttributeValues ?? {}) as Record<string, unknown>,
        );
        items.set(`${key.PK}|${key.SK}`, item);
        return {};
      }
      if (command instanceof DeleteCommand) {
        const key = command.input.Key as Record<string, string>;
        items.delete(`${key.PK}|${key.SK}`);
        return {};
      }
      if (command instanceof QueryCommand) {
        const values = command.input.ExpressionAttributeValues as Record<string, string>;
        let found = [...items.values()]
          .filter((i) => i.PK === values[":pk"] && String(i.SK).startsWith(values[":prefix"] as string))
          .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
        if (command.input.ScanIndexForward === false) found = found.reverse();
        // 続きの問い合わせ(ExclusiveStartKey の項目のあとから)と、1 回で返す数
        const start = command.input.ExclusiveStartKey as Record<string, string> | undefined;
        if (start) found = found.slice(found.findIndex((i) => i.SK === start.SK) + 1);
        const size = command.input.Limit ?? options.queryPageSize;
        const page = size ? found.slice(0, size) : found;
        const last = page.at(-1);
        const more = last !== undefined && page.length < found.length;
        return { Items: page, ...(more ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}) };
      }
      if (command instanceof ScanCommand) {
        // SK の接頭辞での絞り込みと、ページ分けだけを真似る(1 回で読む数は、絞り込みの前に数える)
        const values = command.input.ExpressionAttributeValues as Record<string, string>;
        const all = [...items.values()].sort((a, b) => `${a.PK}|${a.SK}`.localeCompare(`${b.PK}|${b.SK}`));
        const start = command.input.ExclusiveStartKey as Record<string, string> | undefined;
        const from = start ? all.findIndex((i) => i.PK === start.PK && i.SK === start.SK) + 1 : 0;
        const size = command.input.Limit ?? options.scanPageSize;
        const page = size ? all.slice(from, from + size) : all.slice(from);
        const last = page.at(-1);
        const more = last !== undefined && from + page.length < all.length;
        return {
          Items: page.filter((i) => String(i.SK).startsWith(values[":prefix"] as string)),
          ...(more ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}),
        };
      }
      throw new Error("unexpected command");
    },
  };
  return { items, sent, client };
}
