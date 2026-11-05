import { Tags } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

/**
 * すべてのスタックとリソースに付ける共通のタグ。値は固定で、環境ごとの接頭辞は入れない
 * (請求の設定でコスト配分タグとして有効にし、サービス全体の費用をこのタグで絞る。docs/app/infra.md)。
 */
export const SERVICE_TAG = { key: "Service", value: "mokumoku-exams" } as const;

/** AWS Budgets の絞り込みで使う、コスト配分タグの形(`user:<キー>$<値>`)。 */
export const SERVICE_TAG_COST_FILTER = `user:${SERVICE_TAG.key}$${SERVICE_TAG.value}`;

/** 共通のタグを、渡したスコープの下のすべてのスタックとリソースに付ける。 */
export function addCommonTags(scope: IConstruct): void {
  Tags.of(scope).add(SERVICE_TAG.key, SERVICE_TAG.value);
}
