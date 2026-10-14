import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";
import type { InfraConfig, PushConfig } from "./config.ts";

/**
 * 送信の Lambda がテーブルに許される操作。購読を利用者をまたいで集めるスキャンと、無効になった購読の削除だけ
 * (書き込みや、テーブルの管理はできない)。
 */
export const PUSH_SENDER_TABLE_ACTIONS = ["dynamodb:Scan", "dynamodb:DeleteItem"];

/**
 * 秘密鍵のパラメーターに許す操作。読み出しだけ。
 * 復号には `aws/ssm`(AWS 管理の鍵)を使う前提で、その鍵のポリシーが、アカウント内から Systems Manager を経た復号を許す。
 * このため `kms:Decrypt` は付けない(自分で管理する鍵で暗号化したときは、別に許す必要がある。docs/app/infra.md)。
 */
export const VAPID_PRIVATE_KEY_ACTIONS = ["ssm:GetParameter"];

/** Lambda に渡す、通知の設定。秘密鍵は値ではなく、パラメーターの名前だけを渡す。 */
export function vapidEnvironment(push: PushConfig): Record<string, string> {
  return {
    VAPID_PUBLIC_KEY: push.publicKey,
    VAPID_PRIVATE_KEY_PARAMETER: push.privateKeyParameter,
    VAPID_SUBJECT: push.subject,
  };
}

/** 秘密鍵のパラメーター 1 つだけを、Lambda に読ませる。 */
export function grantReadVapidPrivateKey(fn: lambda.Function, push: PushConfig): void {
  // 名前は `/` で始まる(config.ts で確かめる)。ARN は `...:parameter/<名前の先頭の / を除いたもの>`
  const parameterArn = Stack.of(fn).formatArn({
    service: "ssm",
    resource: "parameter",
    resourceName: push.privateKeyParameter.slice(1),
  });
  fn.addToRolePolicy(new iam.PolicyStatement({ actions: VAPID_PRIVATE_KEY_ACTIONS, resources: [parameterArn] }));
}

/** 毎日の送信の時刻(UTC)。日本時間の 20:00 */
export const PUSH_SCHEDULE = { minute: "0", hour: "11" };

/** Lambda の handler。scripts/lib/push-asset.ts が作る `daily.js` の `handler` */
export const PUSH_HANDLER = "daily.handler";

type Props = StackProps & {
  config: InfraConfig;
  push: PushConfig;
  /** `npm run build:lambda` が作る、送信の Lambda のディレクトリ(dist/push) */
  pushCodePath: string;
  /** 購読を置くテーブル(DataStack の出力。履歴と同じテーブル) */
  historyTable: dynamodb.ITable;
};

/** プッシュ通知の送信。毎日のスケジュールで Lambda を動かし、購読しているすべての端末にリマインドを送る。 */
export class PushStack extends Stack {
  readonly senderFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);
    const { config, push } = props;

    const logGroup = new logs.LogGroup(this, "SenderLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.senderFunction = new lambda.Function(this, "SenderFunction", {
      functionName: `${config.stackPrefix}-push-sender`,
      logGroup,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      handler: PUSH_HANDLER,
      code: lambda.Code.fromAsset(props.pushCodePath),
      memorySize: 256,
      timeout: Duration.minutes(1),
      // 非同期の呼び出しが失敗しても、やり直さない(やり直すと、送れた端末にも同じ通知がもう一度届く)
      retryAttempts: 0,
      environment: {
        NODE_ENV: "production",
        HISTORY_TABLE_NAME: props.historyTable.tableName,
        ...vapidEnvironment(push),
      },
    });
    this.senderFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: PUSH_SENDER_TABLE_ACTIONS, resources: [props.historyTable.tableArn] }),
    );

    grantReadVapidPrivateKey(this.senderFunction, push);

    new events.Rule(this, "DailySchedule", {
      description: "毎日、プッシュ通知のリマインドを送る",
      schedule: events.Schedule.cron(PUSH_SCHEDULE),
      // 失敗しても送り直さない(同じ日に、同じ通知が 2 回届かないように)
      targets: [new targets.LambdaFunction(this.senderFunction, { retryAttempts: 0 })],
    });
  }
}
