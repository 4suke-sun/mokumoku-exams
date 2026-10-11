import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { DocumentSender } from "./repository.ts";

/** DynamoDB の Put / Query / Delete だけを、メモリ上で真似る。送られた命令も記録する。 */
export function fakeTable() {
  const items = new Map<string, Record<string, unknown>>();
  const sent: unknown[] = [];
  const client: DocumentSender = {
    async send(command) {
      sent.push(command);
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        items.set(`${item.PK}|${item.SK}`, item);
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
