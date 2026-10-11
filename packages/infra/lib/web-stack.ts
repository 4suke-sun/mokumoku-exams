import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";
import type { InfraConfig } from "./config.ts";

/** アプリがオリジンの合言葉を確かめるヘッダー名(packages/app/src/lib/origin-verify.ts と同じ) */
export const ORIGIN_VERIFY_HEADER = "x-origin-verify";
/** Lambda 上でアプリが待ち受けるポート */
const APP_PORT = "8080";

type Props = StackProps & {
  config: InfraConfig;
  /** `npm run build:lambda` が作る、Lambda に載せるアプリのディレクトリ */
  lambdaCodePath: string;
  /** 同じく、S3 に置く静的ファイルのディレクトリ */
  staticAssetsPath: string;
  /** アプリが認証で使う Cognito のクライアント ID(AuthStack の出力) */
  userPoolClientId: string;
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
    const appFunction = new lambda.Function(this, "AppFunction", {
      functionName: `${config.stackPrefix}-app`,
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
      },
    });

    // Function URL は認証なし。CloudFront が付ける合言葉のヘッダーを、アプリが確かめて、直接のアクセスを断る
    const functionUrl = appFunction.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    const dynamicOrigin = new origins.FunctionUrlOrigin(functionUrl, {
      customHeaders: { [ORIGIN_VERIFY_HEADER]: config.originVerifyValue },
    });
    const staticOrigin = origins.S3BucketOrigin.withOriginAccessControl(assetsBucket);

    this.distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `${config.stackPrefix} web`,
      defaultBehavior: {
        origin: dynamicOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // キャッシュの設定は、別の段階で整える
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        "/_next/static/*": {
          origin: staticOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
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

    new CfnOutput(this, "DistributionDomainName", { value: this.distribution.distributionDomainName });
  }
}
