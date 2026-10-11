import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
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

/** DynamoDB の Put / Get / Update / Query / Delete だけを、メモリ上で真似る。送られた命令も記録する。 */
export function fakeTable() {
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
        if (command.input.Limit) found = found.slice(0, command.input.Limit);
        return { Items: found };
      }
      throw new Error("unexpected command");
    },
  };
  return { items, sent, client };
}
