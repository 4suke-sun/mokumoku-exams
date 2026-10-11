import { fileURLToPath } from "node:url";
import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import {
  ADMIN_GROUP_NAME,
  AuthStack,
  PASSWORD_MIN_LENGTH,
  REFRESH_TOKEN_DAYS,
  TEMP_PASSWORD_DAYS,
  USER_ADMIN_ACTIONS,
} from "./auth-stack.ts";
import type { CustomDomain, InfraConfig, PushConfig } from "./config.ts";
import { DataStack, HISTORY_TABLE_ACTIONS, POINT_IN_TIME_RECOVERY_DAYS } from "./data-stack.ts";
import { PUSH_HANDLER, PUSH_SCHEDULE, PUSH_SENDER_TABLE_ACTIONS, PushStack } from "./push-stack.ts";
import { ORIGIN_VERIFY_HEADER, WebStack } from "./web-stack.ts";

const config: InfraConfig = {
  stackPrefix: "test",
  webAdapterLayerArn: "arn:aws:lambda:us-east-1:123456789012:layer:LambdaAdapterLayerX86:25",
  originVerifyValue: "o".repeat(32),
};
const env = { account: "123456789012", region: "us-east-1" };
// 見本の鍵(形だけを合わせた値。実際の鍵ではない)
const push: PushConfig = { publicKey: "P".repeat(87), privateKey: "k".repeat(43), subject: "mailto:admin@example.com" };
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
    userPoolClientId: "client-example",
    userPoolId: "pool-example",
    userPoolArn: USER_POOL_ARN,
    historyTable: data.table,
  });
  return Template.fromStack(stack);
}

function pushTemplate(): Template {
  const app = new App();
  const data = new DataStack(app, "Data", { env, synthesizer });
  const stack = new PushStack(app, "Push", {
    env,
    synthesizer,
    config: { ...config, push },
    push,
    pushCodePath: fixture("push"),
    historyTable: data.table,
  });
  return Template.fromStack(stack);
}

describe("AuthStack", () => {
  it("合成すると_スナップショットと一致する", () => {
    expect(authTemplate().toJSON()).toMatchSnapshot();
  });

  it("セルフサインアップが禁止されている", () => {
    authTemplate().hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
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

describe("AuthStack のパスワードと招待", () => {
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

  it("招待メールに_ユーザー名と仮パスワードの差し込みがある", () => {
    const [pool] = Object.values(authTemplate().findResources("AWS::Cognito::UserPool"));
    const message = pool?.Properties.AdminCreateUserConfig.InviteMessageTemplate;
    expect(message.EmailMessage).toContain("{username}");
    expect(message.EmailMessage).toContain("{####}");
    expect(message.EmailSubject).toBeTruthy();
  });

  it("再設定のメールは確認コード方式で_コードの差し込みがある", () => {
    const [pool] = Object.values(authTemplate().findResources("AWS::Cognito::UserPool"));
    expect(pool?.Properties.EmailVerificationMessage).toContain("{####}");
    expect(pool?.Properties.VerificationMessageTemplate.DefaultEmailOption).toBe("CONFIRM_WITH_CODE");
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

  it("Lambda は_Cognito の一覧・招待・無効化だけを_そのユーザープールに限って許される", () => {
    expect([...USER_ADMIN_ACTIONS].sort()).toEqual([
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminDisableUser",
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
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: { CacheBehaviors: [{ PathPattern: "/_next/static/*" }] },
    });
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

  it("エラーと実行制限のアラームが_通知先のトピックにつながる", () => {
    const template = webTemplate();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
    for (const metricName of ["Errors", "Throttles"]) {
      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        MetricName: metricName,
        Namespace: "AWS/Lambda",
        AlarmActions: [{ Ref: Match.stringLikeRegexp("AlarmTopic") }],
      });
    }
  });

  it("公開の URL と通知の鍵は_設定したときだけ Lambda に渡す", () => {
    const [plain] = Object.values(webTemplate().findResources("AWS::Lambda::Function")).filter(
      (f) => f.Properties.Handler === "run.sh",
    );
    for (const name of ["SITE_URL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      expect(plain?.Properties.Environment.Variables[name], name).toBeUndefined();
    }
    webTemplate(undefined, { siteUrl: "https://example.com", push }).hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: {
          SITE_URL: "https://example.com",
          VAPID_PUBLIC_KEY: push.publicKey,
          VAPID_PRIVATE_KEY: push.privateKey,
          VAPID_SUBJECT: push.subject,
        },
      },
    });
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
          VAPID_PRIVATE_KEY: push.privateKey,
          VAPID_SUBJECT: push.subject,
        },
      },
    });
    template.resourceCountIs("AWS::Lambda::Url", 0);
  });

  it("送信の Lambda は_テーブルのスキャンと削除だけを許され_全リソースへの権限を持たない", () => {
    const policies = Object.values(pushTemplate().findResources("AWS::IAM::Policy"));
    const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const table = statements.filter((s) => JSON.stringify(s.Action).includes("dynamodb:"));
    expect(table).toHaveLength(1);
    expect([...table[0].Action].sort()).toEqual([...PUSH_SENDER_TABLE_ACTIONS].sort());
    expect(JSON.stringify(table[0].Resource)).not.toContain("*");
    expect(statements.filter((s) => s.Resource === "*")).toEqual([]);
  });

  it("送信の Lambda のログに_保持期間がある", () => {
    pushTemplate().hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
  });
});
