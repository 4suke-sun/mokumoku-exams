import { RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import type { Construct } from "constructs";

/** アプリが履歴の保存に使う操作。テーブルへの最小の権限として、WebStack が Lambda に与える。 */
export const HISTORY_TABLE_ACTIONS = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem"];

/** データ。学習の履歴を置く DynamoDB の単一テーブル(PK=USER#{sub} / SK で種別を分岐する)。 */
export class DataStack extends Stack {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    this.table = new dynamodb.Table(this, "HistoryTable", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      // 使った分だけの課金(使わなければ、ほぼ無料)。暗号化は、既定の AWS 所有のキー(追加の費用なし)
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // 利用者のデータを失わないよう、スタックを消してもテーブルは残す(バックアップと削除保護は、別の段階で扱う)
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
