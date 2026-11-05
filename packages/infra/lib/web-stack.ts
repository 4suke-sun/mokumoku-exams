import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";
import { USER_ADMIN_ACTIONS } from "./auth-stack.ts";
import type { InfraConfig } from "./config.ts";
import { HISTORY_TABLE_ACTIONS } from "./data-stack.ts";
import { grantReadVapidPrivateKey, vapidEnvironment } from "./push-stack.ts";

/** アプリがオリジンの合言葉を確かめるヘッダー名(packages/app/src/lib/origin-verify.ts と同じ) */
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";
/** アプリが API の失敗を記録するときの印(packages/app/src/lib/api/log.ts の `API_FAILURE_EVENT` と同じ) */
export const API_FAILURE_EVENT = "api-failure";
/** 5xx の件数のメトリクスの名前 */
export const API_FAILURE_METRIC = "ApiServerErrors";
/** Lambda 上でアプリが待ち受けるポート */
const APP_PORT = "8080";
/** アプリのログを残す期間 */
const LOG_RETENTION = logs.RetentionDays.ONE_MONTH;
/** `public/*` のうち、CloudFront が S3 から配る経路。ファイル名にハッシュがないので、キャッシュは短くする */
export const PUBLIC_ASSET_PATHS = ["/brand/*", "/icons/*"];
/** Service Worker。更新がすぐに行き渡るよう、キャッシュしない */
export const SERVICE_WORKER_PATH = "/sw.js";
/** ブランドの画像とアイコンを、ブラウザが手元に置く期間(1 日) */
const PUBLIC_ASSET_MAX_AGE = Duration.days(1);
/**
 * CSP。まずは報告だけ(`Content-Security-Policy-Report-Only`)で付け、違反をブラウザのコンソールで確かめる。
 * Next が埋め込むインラインのスクリプト(描画のデータ、テーマの初期化)と、インラインの style 属性(進み具合の幅など)を使うので、
 * 当面は 'unsafe-inline' を許す。強制に切り替える条件は docs/app/infra.md。
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");
/** HSTS の有効期間(1 年) */
const HSTS_MAX_AGE = Duration.days(365);

type Props = StackProps & {
  config: InfraConfig;
  /** `npm run build:lambda` が作る、Lambda に載せるアプリのディレクトリ */
  lambdaCodePath: string;
  /** 同じく、S3 に置く静的ファイル(`/_next/static/*`。ファイル名にハッシュが入る)のディレクトリ */
  staticAssetsPath: string;
  /** 同じく、S3 に置く `public/*`(ブランドの画像、アイコン、Service Worker)のディレクトリ */
  publicAssetsPath: string;
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
  /** アラームの通知先。送信のスタックのアラームも、ここへ送る */
  readonly alarmTopic: sns.Topic;

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
      // 同時実行の上限(設定したときだけ)。上限に達したときの実行の制限は、AppThrottlesAlarm で知らせる
      ...(config.appReservedConcurrency ? { reservedConcurrentExecutions: config.appReservedConcurrency } : {}),
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
        // 設定したときだけ渡す。sitemap の絶対 URL と、通知(購読の公開鍵と、テスト通知の送信)に使う
        ...(config.siteUrl ? { SITE_URL: config.siteUrl } : {}),
        ...(config.push ? vapidEnvironment(config.push) : {}),
      },
    });
    // 履歴のテーブルに対して、必要な操作だけを許す(スキャンやテーブルの管理はできない)
    appFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: HISTORY_TABLE_ACTIONS, resources: [props.historyTable.tableArn] }),
    );
    // 管理者の画面の一覧・無効化と、登録し直しの状態の確認・削除だけを、このユーザープールに限って許す
    appFunction.addToRolePolicy(
      new iam.PolicyStatement({ actions: USER_ADMIN_ACTIONS, resources: [props.userPoolArn] }),
    );

    // テスト通知の送信に使う秘密鍵は、そのパラメーター 1 つだけを読める
    if (config.push) grantReadVapidPrivateKey(appFunction, config.push);

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
      // 報告だけの CSP は、セキュリティヘッダーの項目にないので、任意のヘッダーとして付ける
      customHeadersBehavior: {
        customHeaders: [
          { header: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY, override: true },
        ],
      },
    });

    // 独自ドメインは、値が渡されたときだけ付ける。なければ、CloudFront の既定のドメインで配信する
    const { customDomain } = config;
    const domain = customDomain
      ? {
          domainNames: [customDomain.domainName],
          certificate: acm.Certificate.fromCertificateArn(this, "Certificate", customDomain.certificateArn),
        }
      : {};

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${config.stackPrefix} web`,
      ...domain,
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
        // `public/*` も S3 から配る(Lambda には載せない)。CloudFront の手元の期間は、オブジェクトの Cache-Control に従う
        ...Object.fromEntries(
          PUBLIC_ASSET_PATHS.map((path) => [
            path,
            {
              origin: staticOrigin,
              viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
              allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
              cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
              responseHeadersPolicy: securityHeaders,
            },
          ]),
        ),
        [SERVICE_WORKER_PATH]: {
          origin: staticOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          responseHeadersPolicy: securityHeaders,
        },
      },
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    // ホストゾーンが渡されたときは、ドメイン名から CloudFront へのレコード(IPv4 と IPv6)を作る
    if (customDomain?.hostedZoneId) {
      const zone = route53.HostedZone.fromHostedZoneId(this, "HostedZone", customDomain.hostedZoneId);
      // 末尾に「.」を付けた完全な名前にして、ゾーンの名前がなくてもレコード名を決められるようにする
      const recordName = `${customDomain.domainName}.`;
      const target = route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.distribution));
      new route53.ARecord(this, "AliasRecord", { zone, recordName, target });
      new route53.AaaaRecord(this, "AliasRecordIpv6", { zone, recordName, target });
    }

    // 同じバケットに 3 つの置き場を配るので、どれも、ほかの置き場のファイルを消さない(prune: false)。
    // 古いファイルも消さずに残す(デプロイの途中や、古い画面を開いたままの人が、消えたファイルを取りに行かないように)
    new s3deploy.BucketDeployment(this, "DeployStaticAssets", {
      sources: [s3deploy.Source.asset(props.staticAssetsPath)],
      destinationBucket: assetsBucket,
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString("public, max-age=31536000, immutable")],
      distribution: this.distribution,
      distributionPaths: ["/_next/static/*"],
    });
    new s3deploy.BucketDeployment(this, "DeployPublicAssets", {
      sources: [s3deploy.Source.asset(props.publicAssetsPath)],
      destinationBucket: assetsBucket,
      prune: false,
      exclude: [SERVICE_WORKER_PATH.slice(1)],
      cacheControl: [s3deploy.CacheControl.maxAge(PUBLIC_ASSET_MAX_AGE), s3deploy.CacheControl.setPublic()],
      distribution: this.distribution,
      distributionPaths: PUBLIC_ASSET_PATHS,
    });
    new s3deploy.BucketDeployment(this, "DeployServiceWorker", {
      sources: [s3deploy.Source.asset(props.publicAssetsPath)],
      destinationBucket: assetsBucket,
      prune: false,
      exclude: ["*"],
      include: [SERVICE_WORKER_PATH.slice(1)],
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution: this.distribution,
      distributionPaths: [SERVICE_WORKER_PATH],
    });

    // 通知先(SNS トピック)。メールの購読は、アドレスが渡されたときだけ作る
    const alarmTopic = new sns.Topic(this, "AlarmTopic");
    if (config.alarmEmail) alarmTopic.addSubscription(new subscriptions.EmailSubscription(config.alarmEmail));
    this.alarmTopic = alarmTopic;

    // アプリが 5xx を返しても、Lambda の呼び出しとしては成功するので、アプリが出す失敗の記録(1 行の JSON)の件数を数える
    const apiFailures = new logs.MetricFilter(this, "ApiServerErrorsFilter", {
      logGroup: appLogGroup,
      filterPattern: logs.FilterPattern.all(
        logs.FilterPattern.stringValue("$.event", "=", API_FAILURE_EVENT),
        logs.FilterPattern.numberValue("$.status", ">=", 500),
      ),
      metricNamespace: config.stackPrefix,
      metricName: API_FAILURE_METRIC,
      metricValue: "1",
    });

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
      new cloudwatch.Alarm(this, "ApiServerErrorsAlarm", {
        alarmDescription: "アプリが 5xx を返しています(API と、入口の認証の検証)",
        metric: apiFailures.metric({ period: Duration.minutes(5), statistic: "Sum" }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    ];
    for (const alarm of alarms) alarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    new CfnOutput(this, "DistributionDomainName", { value: this.distribution.distributionDomainName });
  }
}
