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
} from "./auth-stack.ts";
import type { InfraConfig } from "./config.ts";
import { ORIGIN_VERIFY_HEADER, WebStack } from "./web-stack.ts";

const config: InfraConfig = {
  stackPrefix: "test",
  webAdapterLayerArn: "arn:aws:lambda:us-east-1:123456789012:layer:LambdaAdapterLayerX86:25",
  originVerifyValue: "o".repeat(32),
};
const env = { account: "123456789012", region: "us-east-1" };
// 既定の識別子ではなく、見本と分かる値にして、スナップショットに環境の由来らしい文字列を入れない
const synthesizer = new DefaultStackSynthesizer({ qualifier: "example" });
const fixture = (name: string) => fileURLToPath(new URL(`./testdata/${name}`, import.meta.url));

function authTemplate(): Template {
  return Template.fromStack(new AuthStack(new App(), "Auth", { env, synthesizer, stackPrefix: config.stackPrefix }));
}

function webTemplate(alarmEmail?: string): Template {
  const stack = new WebStack(new App(), "Web", {
    env,
    synthesizer,
    config: { ...config, alarmEmail },
    lambdaCodePath: fixture("lambda"),
    staticAssetsPath: fixture("static"),
    userPoolClientId: "client-example",
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

describe("WebStack", () => {
  it("Lambda に_Cognito のクライアント ID を渡す", () => {
    webTemplate().hasResourceProperties("AWS::Lambda::Function", {
      Environment: { Variables: { COGNITO_CLIENT_ID: "client-example" } },
    });
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

  it("通知先のメールは_指定したときだけ購読される", () => {
    webTemplate().resourceCountIs("AWS::SNS::Subscription", 0);
    webTemplate("alerts@example.com").hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alerts@example.com",
    });
  });
});
