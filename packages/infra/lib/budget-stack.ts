import { Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import type { Construct } from "constructs";
import type { BudgetConfig } from "./config.ts";
import { SERVICE_TAG_COST_FILTER } from "./tags.ts";

/** 予算に対する割合(%)ごとに知らせる条件。実績が近づいたとき・超えたときと、月末までの予測が超えそうなとき。 */
export const BUDGET_NOTIFICATIONS = [
  { notificationType: "ACTUAL", threshold: 80 },
  { notificationType: "ACTUAL", threshold: 100 },
  { notificationType: "FORECASTED", threshold: 100 },
] as const;

type Props = StackProps & { stackPrefix: string; budget: BudgetConfig };

/** 月の費用の予算。共通のタグ(コスト配分タグ)で絞った費用が、予算を超えそうなときにメールで知らせる。 */
export class BudgetStack extends Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetName: `${props.stackPrefix}-monthly`,
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.budget.monthlyUsd, unit: "USD" },
        // コスト配分タグを請求の設定で有効にする前の費用と、タグを付けられない費用は、ここに数えられない
        costFilters: { TagKeyValue: [SERVICE_TAG_COST_FILTER] },
      },
      notificationsWithSubscribers: BUDGET_NOTIFICATIONS.map(({ notificationType, threshold }) => ({
        notification: {
          notificationType,
          comparisonOperator: "GREATER_THAN",
          threshold,
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "EMAIL", address: props.budget.email }],
      })),
    });
  }
}
