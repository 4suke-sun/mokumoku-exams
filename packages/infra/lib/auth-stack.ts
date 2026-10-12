import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";

/** 管理者のグループ。packages/app の lib/auth/admin.ts の ADMIN_GROUP と同じ(両方のテストで値を固定している) */
export const ADMIN_GROUP_NAME = "admins";
/** packages/app の lib/auth/password.ts と同じ(両方のテストで値を固定している) */
export const PASSWORD_MIN_LENGTH = 12;
/** packages/app の lib/auth/session.ts の REFRESH_TOKEN_DAYS と同じ(同上) */
export const REFRESH_TOKEN_DAYS = 30;
/** 招待で発行する仮パスワードの有効日数 */
export const TEMP_PASSWORD_DAYS = 7;
/**
 * アプリの管理者の画面が使う、Cognito の管理 API(一覧・招待・無効化)。最小の権限として、WebStack が Lambda に
 * この UserPool に限って与える(packages/app の lib/auth/user-admin.ts と対応する)。
 */
export const USER_ADMIN_ACTIONS = [
  "cognito-idp:ListUsers",
  "cognito-idp:AdminCreateUser",
  "cognito-idp:AdminDisableUser",
];

type Props = StackProps & { stackPrefix: string };

/** 認証。招待された人だけが使える Cognito UserPool(Identity Pool は作らない)。 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${props.stackPrefix}-users`,
      // セルフサインアップを禁止し、管理者の招待だけでユーザーを作る
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // 招待メール。{username} と {####}(仮パスワード)は Cognito が差し込む。サイトの URL は管理者が添えて伝える
      userInvitation: {
        emailSubject: "【もくもく問題集】招待のお知らせ",
        emailBody: [
          "もくもく問題集に招待されました。",
          "",
          "ログイン用のメールアドレス: {username}",
          "仮のパスワード: {####}",
          "",
          `仮のパスワードの有効期限は ${TEMP_PASSWORD_DAYS} 日間です。ログイン画面で入力すると、これから使うパスワードを決められます。`,
          "心当たりがない場合は、このメールを破棄してください。",
        ].join("\n"),
      },
      // パスワード再設定の確認コード。有効期間は Cognito の固定(1 時間)
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: "【もくもく問題集】パスワード再設定の確認コード",
        emailBody: [
          "パスワードの再設定を受け付けました。",
          "",
          "確認コード: {####}",
          "",
          "確認コードの有効期限は 1 時間です。心当たりがない場合は、このメールを破棄してください(パスワードは変わりません)。",
        ].join("\n"),
      },
      passwordPolicy: {
        minLength: PASSWORD_MIN_LENGTH,
        tempPasswordValidity: Duration.days(TEMP_PASSWORD_DAYS),
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      // 利用者のデータを失わないよう、スタックを消してもユーザープールは残す
      removalPolicy: RemovalPolicy.RETAIN,
    });

    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: ADMIN_GROUP_NAME,
      description: "管理者(招待・無効化などの管理操作ができる)",
    });

    // ブラウザから使うクライアントなので、シークレットは持たない
    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: `${props.stackPrefix}-web`,
      generateSecret: false,
      // アプリのサーバーが、メールアドレスとパスワードで認証する(通信は HTTPS のみ)。更新はリフレッシュトークンで行う
      authFlows: { userPassword: true },
      refreshTokenValidity: Duration.days(REFRESH_TOKEN_DAYS),
      // トークンの失効(ログアウトで無効化)を使えるようにする
      enableTokenRevocation: true,
      // ホスト画面(OAuth)は使わない。暗黙的フローなどが、既定で有効にならないようにする
      disableOAuth: true,
      preventUserExistenceErrors: true,
    });

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
  }
}
