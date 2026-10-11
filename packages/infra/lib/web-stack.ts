import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { USER_ADMIN_ACTIONS } from "./auth-stack.ts";
import type { InfraConfig } from "./config.ts";
import { HISTORY_TABLE_ACTIONS } from "./data-stack.ts";

/** アプリがオリジンの合言葉を確かめるヘッダー名(packages/app/src/lib/origin-verify.ts と同じ) */
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";
/** Lambda 上でアプリが待ち受けるポート */
const APP_PORT = "8080";
/** アプリのログを残す期間 */
const LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
/** HSTS の有効期間(1 年) */
const HSTS_MAX_AGE = Duration.days(365);

type Props = StackProps & {
  config: InfraConfig;
  /** `npm run build:lambda` が作る、Lambda に載せるアプリのディレクトリ */
  lambdaCodePath: string;
  /** 同じく、S3 に置く静的ファイルのディレクトリ */
  staticAssetsPath: string;
  /** アプリが認証で使う Cognito のクライアント ID(AuthStack の出力) */
  userPoolClientId: string;
  /** アプリが ID トークンの検証で使う Cognito のユーザープール ID(AuthStack の出力) */
  userPoolId: string;
  /** 管理者の画面が管理 API を呼ぶ、Cognito のユーザープールの ARN(AuthStack の出力。権限の対象を限る) */
  userPoolArn: string;
  /** 履歴を置くテーブル(DataStack の出力) */
  historyTable: dynamodb.ITable;
};

/** ホスティング。Lambda Web Adapter 上の Next.js を CloudFront の背後に置き、静的ファイルは S3 から配る。 */
export class WebStack extends Stack {
  readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);
    const { config } = props;

    const assetsBucket = new s3.Bucket(this, "AssetsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const webAdapter = lambda.LayerVersion.fromLayerVersionArn(this, "WebAdapterLayer", config.webAdapterLayerArn);
    // ログのグループを自前で作り、保持期間を決める(任せると無期限に溜まる)
    const appLogGroup = new logs.LogGroup(this, "AppLogGroup", {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const appFunction = new lambda.Function(this, "AppFunction", {
      functionName: `${config.stackPrefix}-app`,
      logGroup: appLogGroup,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      // Lambda Web Adapter が、run.sh の起動したサーバーへリクエストを渡す
      handler: "run.sh",
      code: lambda.Code.fromAsset(props.lambdaCodePath),
      layers: [webAdapter],
      memorySize: 1024,
      timeout: Duration.seconds(30),
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        // アプリが本番の挙動(合言葉が未設定なら、すべて断る)になるよう、明示する
        NODE_ENV: "production",
        AWS_LWA_PORT: APP_PORT,
        PORT: APP_PORT,
        HOSTNAME: "0.0.0.0",
        ORIGIN_VERIFY_VALUE: config.originVerifyValue,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        COGNITO_USER_POOL_ID: props.userPoolId,
        HISTORY_TABLE_NAME: props.historyTable.tableName,
      },
    });
    // 履歴のテーブルに対して、必要な操作だけを許す(スキャンやテーブルの管理はできない)
    appFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: HISTORY_TABLE_ACTIONS, resources: [props.historyTable.tableArn] }),
    );
    // 管理者の画面の、利用者の一覧・招待・無効化だけを、このユーザープールに限って許す
    appFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: USER_ADMIN_ACTIONS, resources: [props.userPoolArn] }),
    );

    // Function URL は認証なし。CloudFront が付ける合言葉のヘッダーを、アプリが確かめて、直接のアクセスを断る
    const functionUrl = appFunction.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const dynamicOrigin = new origins.FunctionUrlOrigin(functionUrl, {
      customHeaders: { [ORIGIN_VERIFY_HEADER]: config.originVerifyValue },
    });
    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(assetsBucket);

    // すべての応答に付けるセキュリティヘッダー。アプリ側が同じヘッダーを付けても、こちらを優先する
    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        strictTransportSecurity: { accessControlMaxAge: HSTS_MAX_AGE, includeSubdomains: true, override: true },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
      },
    });

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${config.stackPrefix} web`,
      defaultBehavior: {
        origin: dynamicOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // 動的な応答(画面と API)はキャッシュしない
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        responseHeadersPolicy: securityHeaders,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        "/_next/static/*": {
          origin: staticOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          // ファイル名にハッシュが入る静的ファイルは、長くキャッシュする
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeaders,
        },
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    new s3deploy.BucketDeployment(this, "DeployStaticAssets", {
      sources: [s3deploy.Source.asset(props.staticAssetsPath)],
      destinationBucket: assetsBucket,
      distribution: this.distribution,
      distributionPaths: ["/_next/static/*"],
    });

    // 通知先(SNS トピック)。メールの購読は、アドレスが渡されたときだけ作る
    const alarmTopic = new sns.Topic(this, "AlarmTopic");
    if (config.alarmEmail) alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));

    const alarms = [
      new cloudwatch.Alarm(this, "AppErrorsAlarm", {
        alarmDescription: "アプリの Lambda でエラーが出ています",
        metric: appFunction.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
      new cloudwatch.Alarm(this, "AppThrottlesAlarm", {
        alarmDescription: "アプリの Lambda が実行を制限されています",
        metric: appFunction.metricThrottles({ period: Duration.minutes(5), statistic: "Sum" }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    for (const alarm of alarms) alarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    new CfnOutput(this, "DistributionDomainName", { value: this.distribution.distributionDomainName });
  }
}
