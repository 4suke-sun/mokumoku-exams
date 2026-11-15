import { fileURLToPath } from "node:url";
import { App, DefaultStackSynthesizer, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as sns from "aws-cdk-lib/aws-sns";
import { describe, expect, it } from "vitest";
import {
  ADMIN_GROUP_NAME,
  AuthStack,
  PASSWORD_MIN_LENGTH,
  REFRESH_TOKEN_DAYS,
  TEMP_PASSWORD_DAYS,
  USER_ADMIN_ACTIONS,
} from "./auth-stack.ts";
import { BUDGET_NOTIFICATIONS, BudgetStack } from "./budget-stack.ts";
import type { BudgetConfig, CustomDomain, FeedbackConfig, InfraConfig, PushConfig } from "./config.ts";
import { DataStack, HISTORY_TABLE_ACTIONS, POINT_IN_TIME_RECOVERY_DAYS } from "./data-stack.ts";
import {
  PUSH_HANDLER,
  PUSH_SCHEDULE,
  PUSH_SENDER_TABLE_ACTIONS,
  PushStack,
  VAPID_PRIVATE_KEY_ACTIONS,
} from "./push-stack.ts";
import { addCommonTags, SERVICE_TAG, SERVICE_TAG_COST_FILTER } from "./tags.ts";
import {
  API_FAILURE_EVENT,
  API_FAILURE_METRIC,
  CONTENT_SECURITY_POLICY,
  ORIGIN_VERIFY_HEADER,
  PUBLIC_ASSET_PATHS,
  SERVICE_WORKER_PATH,
  WebStack,
} from "./web-stack.ts";

const config: InfraConfig = {
  stackPrefix: "test",
  webAdapterLayerArn: "arn:aws:lambda:us-east-1:123456789012:layer:LambdaAdapterLayerX86:25",
  originVerifyValue: "o".repeat(32),
};
const env = { account: "123456789012", region: "us-east-1" };
// 見本の公開鍵(形だけを合わせた値。実際の鍵ではない)と、秘密鍵を置くパラメーターの名前
const push: PushConfig = {
  publicKey: "P".repeat(87),
  privateKeyParameter: "/example/push/vapid-private-key",
  subject: "mailto:admin@example.com",
};
// パラメーター 1 つの ARN(ワイルドカードなし)。パーティションは、合成の時点では参照のまま
const PARAMETER_ARN = {
  "Fn::Join": [
    "",
    ["arn:", { Ref: "AWS::Partition" }, ":ssm:us-east-1:123456789012:parameter/example/push/vapid-private-key"],
  ],
};

// 送信フォームの GitHub App の見本の設定(すべてプレースホルダー)
const feedback: FeedbackConfig = {
  appId: "123",
  installationId: "456",
  privateKeyParameter: "/example/feedback/github-app-private-key",
};
const FEEDBACK_PARAMETER_ARN = {
  "Fn::Join": [
    "",
    [
      "arn:",
      { Ref: "AWS::Partition" },
      ":ssm:us-east-1:123456789012:parameter/example/feedback/github-app-private-key",
    ],
  ],
};

/** テンプレートの IAM ポリシーの文の一覧 */
function statementsOf(template: Template) {
  return Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
    (policy) => policy.Properties.PolicyDocument.Statement,
  );
}

/**
 * 秘密鍵のパラメーターを読む文が、渡したパラメーター(既定は VAPID の 1 つ)だけに限られ、それぞれ読み出しだけで、
 * ワイルドカードを使わず、KMS の権限を足していないことを確かめる。文は、パラメーター 1 つにつき 1 つと数える。
 */
function expectParameterReadOnly(template: Template, parameterArns: unknown[] = [PARAMETER_ARN]): void {
  const statements = statementsOf(template);
  const ssm = statements.filter((s) => JSON.stringify(s.Action).includes("ssm:"));
  expect(ssm).toHaveLength(parameterArns.length);
  for (const statement of ssm) {
    expect([statement.Action].flat()).toEqual(VAPID_PRIVATE_KEY_ACTIONS);
    expect(JSON.stringify(statement.Resource)).not.toContain("*");
  }
  expect(ssm.map((statement) => statement.Resource)).toEqual(expect.arrayContaining(parameterArns));
  expect(statements.filter((s) => JSON.stringify(s.Action).includes("kms:"))).toEqual([]);
}
// 独自ドメインの見本の値(すべてプレースホルダー)
const domain: CustomDomain = {
  domainName: "app.example.com",
  certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000",
  hostedZoneId: "Z0000000000EXAMPLE",
};
// 既定の識別子ではなく、見本と分かる値にして、スナップショットに環境の由来らしい文字列を入れない
const synthesizer = new DefaultStackSynthesizer({ qualifier: "example" });
const USER_POOL_ARN = "arn:aws:cognito-idp:us-east-1:123456789012:userpool/pool-example";
const fixture = (name: string) => fileURLToPath(new URL(`./testdata/${name}`, import.meta.url));

function authTemplate(): Template {
  return Template.fromStack(new AuthStack(new App(), "Auth", { env, synthesizer, stackPrefix: config.stackPrefix }));
}

function dataTemplate(): Template {
  return Template.fromStack(new DataStack(new App(), "Data", { env, synthesizer }));
}

function webTemplate(alarmEmail?: string, extra: Partial<InfraConfig> = {}): Template {
  const app = new App();
  const data = new DataStack(app, "Data", { env, synthesizer });
  const stack = new WebStack(app, "Web", {
    env,
    synthesizer,
    config: { ...config, alarmEmail, ...extra },
    lambdaCodePath: fixture("lambda"),
    staticAssetsPath: fixture("static"),
    publicAssetsPath: fixture("public"),
    userPoolClientId: "client-example",
    userPoolId: "pool-example",
    userPoolArn: USER_POOL_ARN,
    historyTable: data.table,
  });
  return Template.fromStack(stack);
}

// 予算の見本の値(すべてプレースホルダー)
const budget: BudgetConfig = { monthlyUsd: 10, email: "billing@example.com" };

function budgetTemplate(): Template {
  return Template.fromStack(
    new BudgetStack(new App(), "Budget", { env, synthesizer, stackPrefix: config.stackPrefix, budget }),
  );
}

function pushTemplate(): Template {
  const app = new App();
  const data = new DataStack(app, "Data", { env, synthesizer });
  // 通知先は、アプリのスタックから受け取る。ここでは、トピックだけを持つスタックで代える
  const alarms = new Stack(app, "Alarms", { env, synthesizer });
  const alarmTopic = new sns.Topic(alarms, "AlarmTopic");
  const stack = new PushStack(app, "Push", {
    env,
    synthesizer,
    config: { ...config, push },
    push,
    pushCodePath: fixture("push"),
    historyTable: data.table,
    alarmTopic,
  });
  return Template.fromStack(stack);
}

describe("AuthStack", () => {
  it("合成すると_スナップショットと一致する", () => {
    expect(authTemplate().toJSON()).toMatchSnapshot();
  });

  it("セルフサインアップが許され_登録の確認はメールで行う", () => {
    authTemplate().hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
      AutoVerifiedAttributes: ["email"],
    });
  });

  it("管理者グループがある_Identity Pool はない", () => {
    // グループ名は、アプリの管理者の判定(packages/app の ADMIN_GROUP)と同じ値。両方のテストで値を固定している
    expect(ADMIN_GROUP_NAME).toBe("admins");
    const template = authTemplate();
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: ADMIN_GROUP_NAME });
    template.resourceCountIs("AWS::Cognito::IdentityPool", 0);
  });

  it("クライアントがシークレットを持たず_OAuth のフローが有効でない", () => {
    const template = authTemplate();
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", { GenerateSecret: false });
    const clients = Object.values(template.findResources("AWS::Cognito::UserPoolClient"));
    expect(clients).toHaveLength(1);
    expect(clients[0]?.Properties.AllowedOAuthFlows).toBeUndefined();
    expect(clients[0]?.Properties.AllowedOAuthFlowsUserPoolClient).toBeFalsy();
  });
});

describe("AuthStack のパスワードと確認コード", () => {
  it("パスワードの規則と仮パスワードの有効期間が_アプリの案内と同じ", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(REFRESH_TOKEN_DAYS).toBe(30);
    authTemplate().hasResourceProperties("AWS::Cognito::UserPool", {
      Policies: {
        PasswordPolicy: {
          MinimumLength: PASSWORD_MIN_LENGTH,
          RequireLowercase: true,
          RequireUppercase: true,
          RequireNumbers: true,
          TemporaryPasswordValidityDays: TEMP_PASSWORD_DAYS,
        },
      },
    });
  });

  it("UserPool は_招待のメールの設定を持たない", () => {
    const [pool] = Object.values(authTemplate().findResources("AWS::Cognito::UserPool"));
    expect(pool?.Properties.AdminCreateUserConfig?.InviteMessageTemplate).toBeUndefined();
  });

  it("確認コードのメールは確認コード方式で_コードの差し込みと_登録と再設定の両方の有効期限がある", () => {
    const [pool] = Object.values(authTemplate().findResources("AWS::Cognito::UserPool"));
    const template = pool?.Properties.VerificationMessageTemplate;
    expect(template.DefaultEmailOption).toBe("CONFIRM_WITH_CODE");
    expect(template.EmailMessage).toContain("{####}");
    expect(template.EmailSubject).toBe("【もくもく問題集】確認コード");
    // 登録の確認(24 時間)と、パスワードの再設定(1 時間)の両方に合う書き方にする
    expect(template.EmailMessage).toContain("24 時間");
    expect(template.EmailMessage).toContain("1 時間");
    expect(template.EmailSubject).not.toContain("再設定");
  });

  it("クライアントは_メールとパスワードの認証と更新だけを許し_トークンの失効を使える", () => {
    const [client] = Object.values(authTemplate().findResources("AWS::Cognito::UserPoolClient"));
    expect(client?.Properties.ExplicitAuthFlows).toEqual(["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]);
    expect(client?.Properties.EnableTokenRevocation).toBe(true);
    expect(client?.Properties.RefreshTokenValidity).toBe(REFRESH_TOKEN_DAYS * 24 * 60);
  });
});

describe("DataStack", () => {
  it("合成すると_スナップショットと一致する", () => {
    expect(dataTemplate().toJSON()).toMatchSnapshot();
  });

  it("テーブルは_PK と SK を持つ単一テーブルで_使った分だけの課金になる", () => {
    const template = dataTemplate();
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    });
  });

  it("テーブルは_追加費用のかかる設定を持たず_スタックを消しても残る", () => {
    const [table] = Object.values(dataTemplate().findResources("AWS::DynamoDB::Table"));
    expect(table?.DeletionPolicy).toBe("Retain");
    expect(table?.UpdateReplacePolicy).toBe("Retain");
    // 暗号化は既定(AWS 所有のキー)のまま。KMS のキーを使うと費用がかかる
    expect(table?.Properties.SSESpecification).toBeUndefined();
    expect(table?.Properties.GlobalSecondaryIndexes).toBeUndefined();
    expect(table?.Properties.StreamSpecification).toBeUndefined();
    expect(table?.Properties.ReplicaSpecification).toBeUndefined();
  });

  it("テーブルは_時点復旧が有効で_戻せる期間が最大になっている", () => {
    dataTemplate().hasResourceProperties("AWS::DynamoDB::Table", {
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
        RecoveryPeriodInDays: POINT_IN_TIME_RECOVERY_DAYS,
      },
    });
    expect(POINT_IN_TIME_RECOVERY_DAYS).toBe(35);
  });

  it("テーブルは_削除保護が有効になっている", () => {
    dataTemplate().hasResourceProperties("AWS::DynamoDB::Table", { DeletionProtectionEnabled: true });
  });
});

describe("WebStack", () => {
  it("Lambda に_Cognito のクライアント ID とユーザープール ID を渡す", () => {
    webTemplate().hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { COGNITO_CLIENT_ID: "client-example", COGNITO_USER_POOL_ID: "pool-example" } },
    });
  });

  it("Lambda に_履歴のテーブル名を渡す", () => {
    webTemplate().hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { HISTORY_TABLE_NAME: Match.anyValue() } },
    });
  });

  it("Lambda は_履歴のテーブルの必要な操作だけを許され_全リソースへの権限を持たない", () => {
    const policies = Object.values(webTemplate().findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const history = statements.filter((s) => JSON.stringify(s.Action).includes("dynamodb:"));
    expect(history).toHaveLength(1);
    expect([...history[0].Action].sort()).toEqual([...HISTORY_TABLE_ACTIONS].sort());
    expect(history[0].Resource).not.toBe("*");
    expect(JSON.stringify(history[0].Resource)).not.toContain("*");
  });

  it("Lambda は_Cognito の一覧・無効化・状態の確認・削除だけを_そのユーザープールに限って許される", () => {
    expect([...USER_ADMIN_ACTIONS].sort()).toEqual([
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:ListUsers",
    ]);
    const policies = Object.values(webTemplate().findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const cognito = statements.filter((s) => JSON.stringify(s.Action).includes("cognito-idp:"));
    expect(cognito).toHaveLength(1);
    expect([...cognito[0].Action].sort()).toEqual([...USER_ADMIN_ACTIONS].sort());
    expect(cognito[0].Resource).toBe(USER_POOL_ARN);
  });

  it("合言葉のヘッダー名が_アプリ側と同じ名前に固定されている", () => {
    expect(ORIGIN_VERIFY_HEADER).toBe("x-origin-verify");
  });

  it("合成すると_スナップショットと一致する", () => {
    expect(webTemplate().toJSON()).toMatchSnapshot();
  });

  it("Function URL は認証なしで_CloudFront が合言葉のヘッダーを付ける", () => {
    const template = webTemplate();
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "NONE" });
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        Origins: [
          {
            OriginCustomHeaders: [{ HeaderName: ORIGIN_VERIFY_HEADER, HeaderValue: config.originVerifyValue }],
          },
          {},
        ],
      },
    });
  });

  it("Lambda の環境変数に_本番の指定と合言葉がある", () => {
    webTemplate().hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { NODE_ENV: "production", ORIGIN_VERIFY_VALUE: config.originVerifyValue } },
    });
  });

  it("静的ファイルは_S3 から配り_バケットは公開されない", () => {
    const template = webTemplate();
    template.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    const [distribution] = Object.values(template.findResources("AWS::CloudFront::Distribution"));
    const behaviors = distribution?.Properties.DistributionConfig.CacheBehaviors as {
      PathPattern: string;
      CachePolicyId: string;
      TargetOriginId: string;
    }[];
    // マネージドのキャッシュポリシー: CachingOptimized / CachingDisabled
    const OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";
    const DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
    expect(Object.fromEntries(behaviors.map((b) => [b.PathPattern, b.CachePolicyId]))).toEqual({
      "/_next/static/*": OPTIMIZED,
      ...Object.fromEntries(PUBLIC_ASSET_PATHS.map((path) => [path, OPTIMIZED])),
      [SERVICE_WORKER_PATH]: DISABLED,
    });
    // どれも、同じ S3 のオリジンから配る
    expect(new Set(behaviors.map((b) => b.TargetOriginId)).size).toBe(1);
  });

  it("静的ファイルの配置_古いファイルを消さず_置き場ごとのキャッシュの期間を付ける", () => {
    const deployments = Object.values(webTemplate().findResources("Custom::CDKBucketDeployment")).map(
      (d) => d.Properties,
    );
    expect(deployments).toHaveLength(3);
    for (const deployment of deployments) expect(deployment.Prune).toBe(false);
    const cacheControls = deployments.map((d) => d.SystemMetadata?.["cache-control"]).sort();
    expect(cacheControls).toEqual(["max-age=86400, public", "no-cache", "public, max-age=31536000, immutable"]);
  });

  it("セキュリティヘッダーが_動的な応答と静的ファイルの両方に付く", () => {
    const template = webTemplate();
    template.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: {
        SecurityHeadersConfig: {
          StrictTransportSecurity: { AccessControlMaxAgeSec: 31536000, IncludeSubdomains: true, Override: true },
          ContentTypeOptions: { Override: true },
          ReferrerPolicy: { ReferrerPolicy: "strict-origin-when-cross-origin", Override: true },
          FrameOptions: { FrameOption: "DENY", Override: true },
        },
      },
    });
    const [distribution] = Object.values(template.findResources("AWS::CloudFront::Distribution"));
    const config = distribution?.Properties.DistributionConfig;
    expect(config.DefaultCacheBehavior.ResponseHeadersPolicyId).toBeDefined();
    expect(config.CacheBehaviors[0].ResponseHeadersPolicyId).toEqual(
      config.DefaultCacheBehavior.ResponseHeadersPolicyId,
    );
  });

  it("動的な応答はキャッシュされず_静的ファイルはキャッシュされる", () => {
    const template = webTemplate();
    const [distribution] = Object.values(template.findResources("AWS::CloudFront::Distribution"));
    const config = distribution?.Properties.DistributionConfig;
    // マネージドのキャッシュポリシー: CachingDisabled / CachingOptimized
    expect(config.DefaultCacheBehavior.CachePolicyId).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
    expect(config.CacheBehaviors[0].CachePolicyId).toBe("658327ea-f89d-4fab-a63d-7e88639e58f6");
  });

  it("アプリのログに_保持期間がある", () => {
    webTemplate().hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  });

  it("エラーと実行制限と 5xx のアラームが_通知先のトピックにつながる", () => {
    const template = webTemplate();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: API_FAILURE_METRIC,
      Namespace: config.stackPrefix,
      Statistic: "Sum",
      Period: 300,
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      AlarmActions: [{ Ref: Match.stringLikeRegexp("AlarmTopic") }],
    });
    for (const metricName of ["Errors", "Throttles"]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metricName,
        Namespace: "AWS/Lambda",
        AlarmActions: [{ Ref: Match.stringLikeRegexp("AlarmTopic") }],
      });
    }
  });

  it("同時実行の上限_設定したときだけアプリの Lambda に付ける", () => {
    const appOf = (template: Template) =>
      Object.values(template.findResources("AWS::Lambda::Function")).find((f) => f.Properties.Handler === "run.sh");
    expect(appOf(webTemplate())?.Properties.ReservedConcurrentExecutions).toBeUndefined();
    expect(appOf(webTemplate(undefined, { appReservedConcurrency: 10 }))?.Properties.ReservedConcurrentExecutions).toBe(
      10,
    );
  });

  it("CSP_報告だけのヘッダーで_すべての応答に付ける", () => {
    webTemplate().hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: {
        CustomHeadersConfig: {
          Items: [{ Header: "Content-Security-Policy-Report-Only", Value: CONTENT_SECURITY_POLICY, Override: true }],
        },
      },
    });
    // 強制のヘッダーは、まだ付けない
    const [policy] = Object.values(webTemplate().findResources("AWS::CloudFront::ResponseHeadersPolicy"));
    expect(policy?.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy).toBeUndefined();
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
  });

  it("アプリのログ_失敗の記録のうち 5xx だけを数えるメトリクスフィルターがある", () => {
    const template = webTemplate();
    template.resourceCountIs("AWS::Logs::MetricFilter", 1);
    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      LogGroupName: { Ref: Match.stringLikeRegexp("AppLogGroup") },
      FilterPattern: `{ ($.event = "${API_FAILURE_EVENT}") && ($.status >= 500) }`,
      MetricTransformations: [
        { MetricNamespace: config.stackPrefix, MetricName: API_FAILURE_METRIC, MetricValue: "1" },
      ],
    });
  });

  it("公開の URL と通知の鍵は_設定したときだけ Lambda に渡す", () => {
    const [plain] = Object.values(webTemplate().findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Handler === "run.sh",
    );
    for (const name of ["SITE_URL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY_PARAMETER", "VAPID_SUBJECT"]) {
      expect(plain?.Properties.Environment.Variables[name], name).toBeUndefined();
    }
    webTemplate(undefined, { siteUrl: "https://example.com", push }).hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          SITE_URL: "https://example.com",
          VAPID_PUBLIC_KEY: push.publicKey,
          VAPID_PRIVATE_KEY_PARAMETER: push.privateKeyParameter,
          VAPID_SUBJECT: push.subject,
        },
      },
    });
  });

  it("秘密鍵は_値ではなくパラメーターの名前だけを渡し_そのパラメーター 1 つだけを読める", () => {
    const template = webTemplate(undefined, { push });
    const [app] = Object.values(template.findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Handler === "run.sh",
    );
    expect(app?.Properties.Environment.Variables.VAPID_PRIVATE_KEY).toBeUndefined();
    expectParameterReadOnly(template);
    // 通知を設定しなければ、パラメーターを読む権限も付けない
    expect(statementsOf(webTemplate()).filter((s) => JSON.stringify(s.Action).includes("ssm:"))).toEqual([]);
  });

  it("送信フォームの App の設定_ID と秘密鍵のパラメーターの名前だけを渡し_秘密鍵の値は渡さない", () => {
    const [plain] = Object.values(webTemplate().findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Handler === "run.sh",
    );
    for (const name of [
      "FEEDBACK_GITHUB_APP_ID",
      "FEEDBACK_GITHUB_INSTALLATION_ID",
      "FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER",
    ]) {
      expect(plain?.Properties.Environment.Variables[name], name).toBeUndefined();
    }
    const template = webTemplate(undefined, { feedback });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          FEEDBACK_GITHUB_APP_ID: feedback.appId,
          FEEDBACK_GITHUB_INSTALLATION_ID: feedback.installationId,
          FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER: feedback.privateKeyParameter,
        },
      },
    });
    const [app] = Object.values(template.findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Handler === "run.sh",
    );
    expect(app?.Properties.Environment.Variables.FEEDBACK_GITHUB_PRIVATE_KEY).toBeUndefined();
    expectParameterReadOnly(template, [FEEDBACK_PARAMETER_ARN]);
  });

  it("通知と送信フォームの両方を設定_アプリの Lambda は 2 つのパラメーターだけを読み出しだけで読める", () => {
    expectParameterReadOnly(webTemplate(undefined, { push, feedback }), [PARAMETER_ARN, FEEDBACK_PARAMETER_ARN]);
  });

  it("通知先のメールは_指定したときだけ購読される", () => {
    webTemplate().resourceCountIs("AWS::SNS::Subscription", 0);
    webTemplate("alerts@example.com").hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alerts@example.com",
    });
  });

  it("独自ドメインがない_CloudFront の既定のドメインで配信し_DNS のレコードを作らない", () => {
    const template = webTemplate();
    const [distribution] = Object.values(template.findResources("AWS::CloudFront::Distribution"));
    expect(distribution?.Properties.DistributionConfig.Aliases).toBeUndefined();
    expect(distribution?.Properties.DistributionConfig.ViewerCertificate).toBeUndefined();
    template.resourceCountIs("AWS::Route53::RecordSet", 0);
  });

  it("独自ドメインがある_CloudFront にドメイン名と証明書を付ける", () => {
    const template = webTemplate(undefined, {
      customDomain: { domainName: domain.domainName, certificateArn: domain.certificateArn },
    });
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        Aliases: [domain.domainName],
        ViewerCertificate: {
          AcmCertificateArn: domain.certificateArn,
          SslSupportMethod: "sni-only",
          MinimumProtocolVersion: "TLSv1.2_2021",
        },
      },
    });
    // ホストゾーンがないときは、DNS は自分で設定する
    template.resourceCountIs("AWS::Route53::RecordSet", 0);
  });

  it("ホストゾーンもある_ドメイン名から CloudFront への IPv4 と IPv6 のレコードを作る", () => {
    const template = webTemplate(undefined, { customDomain: domain });
    template.resourceCountIs("AWS::Route53::RecordSet", 2);
    for (const type of ["A", "AAAA"]) {
      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Name: `${domain.domainName}.`,
        Type: type,
        HostedZoneId: domain.hostedZoneId,
        AliasTarget: { DNSName: { "Fn::GetAtt": [Match.stringLikeRegexp("Distribution"), "DomainName"] } },
      });
    }
  });
});

describe("PushStack", () => {
  it("合成すると_スナップショットと一致する", () => {
    expect(pushTemplate().toJSON()).toMatchSnapshot();
  });

  it("送信の Lambda は_毎日決まった時刻に動き_失敗しても送り直さない", () => {
    expect(PUSH_SCHEDULE).toEqual({ minute: "0", hour: "11" });
    const template = pushTemplate();
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "cron(0 11 * * ? *)",
      State: "ENABLED",
      Targets: [
        {
          Arn: { "Fn::GetAtt": [Match.stringLikeRegexp("SenderFunction"), "Arn"] },
          RetryPolicy: { MaximumRetryAttempts: 0 },
        },
      ],
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
    });
    // ルールのターゲットだけでなく、Lambda 自身の非同期呼び出しも、再試行しない
    template.resourceCountIs("AWS::Lambda::EventInvokeConfig", 1);
    template.hasResourceProperties("AWS::Lambda::EventInvokeConfig", {
      FunctionName: { Ref: Match.stringLikeRegexp("SenderFunction") },
      Qualifier: "$LATEST",
      MaximumRetryAttempts: 0,
    });
  });

  it("送信の Lambda は_鍵とテーブル名を受け取り_外から呼べる URL を持たない", () => {
    const template = pushTemplate();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: PUSH_HANDLER,
      Runtime: "nodejs22.x",
      Environment: {
        Variables: {
          NODE_ENV: "production",
          HISTORY_TABLE_NAME: Match.anyValue(),
          VAPID_PUBLIC_KEY: push.publicKey,
          VAPID_PRIVATE_KEY_PARAMETER: push.privateKeyParameter,
          VAPID_SUBJECT: push.subject,
        },
      },
    });
    template.resourceCountIs("AWS::Lambda::Url", 0);
  });

  it("送信の Lambda は_秘密鍵の値を受け取らず_そのパラメーター 1 つだけを読める", () => {
    const template = pushTemplate();
    const [sender] = Object.values(template.findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Handler === PUSH_HANDLER,
    );
    expect(sender?.Properties.Environment.Variables.VAPID_PRIVATE_KEY).toBeUndefined();
    expectParameterReadOnly(template);
  });

  it("送信の Lambda は_テーブルのスキャンと削除だけを許され_全リソースへの権限を持たない", () => {
    const statements = statementsOf(pushTemplate());
    const table = statements.filter((s) => JSON.stringify(s.Action).includes("dynamodb:"));
    expect(table).toHaveLength(1);
    expect([...table[0].Action].sort()).toEqual([...PUSH_SENDER_TABLE_ACTIONS].sort());
    expect(JSON.stringify(table[0].Resource)).not.toContain("*");
    expect(statements.filter((s) => s.Resource === "*")).toEqual([]);
  });

  it("送信の Lambda のエラー_1 回でアプリと同じ通知先へ送るアラームがある", () => {
    const template = pushTemplate();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 1);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Namespace: "AWS/Lambda",
      Dimensions: [{ Name: "FunctionName", Value: { Ref: Match.stringLikeRegexp("SenderFunction") } }],
      Statistic: "Sum",
      Threshold: 1,
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      AlarmActions: [{ "Fn::ImportValue": Match.stringLikeRegexp("AlarmTopic") }],
    });
  });

  it("送信の Lambda のログに_保持期間がある", () => {
    pushTemplate().hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  });
});

describe("共通のタグ", () => {
  it("タグのキーと値は_環境の接頭辞を含まない固定の値", () => {
    expect(SERVICE_TAG).toEqual({ key: "Service", value: "mokumoku-exams" });
    expect(SERVICE_TAG_COST_FILTER).toBe("user:Service$mokumoku-exams");
  });

  it("アプリに付ける_各スタックのリソースに同じタグが付く", () => {
    const app = new App();
    addCommonTags(app);
    const auth = new AuthStack(app, "Auth", { env, synthesizer, stackPrefix: config.stackPrefix });
    const data = new DataStack(app, "Data", { env, synthesizer });
    Template.fromStack(auth).hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTags: { [SERVICE_TAG.key]: SERVICE_TAG.value },
    });
    Template.fromStack(data).hasResourceProperties("AWS::DynamoDB::Table", {
      Tags: Match.arrayWith([{ Key: SERVICE_TAG.key, Value: SERVICE_TAG.value }]),
    });
  });
});

describe("BudgetStack", () => {
  it("合成すると_スナップショットと一致する", () => {
    expect(budgetTemplate().toJSON()).toMatchSnapshot();
  });

  it("月の費用の予算を_共通のタグで絞って_設定した金額で作る", () => {
    const template = budgetTemplate();
    template.resourceCountIs("AWS::Budgets::Budget", 1);
    template.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: {
        BudgetName: `${config.stackPrefix}-monthly`,
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
        BudgetLimit: { Amount: budget.monthlyUsd, Unit: "USD" },
        CostFilters: { TagKeyValue: [SERVICE_TAG_COST_FILTER] },
      },
    });
  });

  it("実績と予測が予算を超えそうなとき_設定した宛先へメールで知らせる", () => {
    const [resource] = Object.values(budgetTemplate().findResources("AWS::Budgets::Budget"));
    const notifications = resource?.Properties.NotificationsWithSubscribers;
    expect(notifications).toHaveLength(BUDGET_NOTIFICATIONS.length);
    const types = notifications.map(
      (n: { Notification: { NotificationType: string } }) => n.Notification.NotificationType,
    );
    expect(new Set(types)).toEqual(new Set(["ACTUAL", "FORECASTED"]));
    for (const n of notifications) {
      expect(n.Notification.ComparisonOperator).toBe("GREATER_THAN");
      expect(n.Notification.ThresholdType).toBe("PERCENTAGE");
      expect(n.Subscribers).toEqual([{ SubscriptionType: "EMAIL", Address: budget.email }]);
    }
  });
});
