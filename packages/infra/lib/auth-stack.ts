import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";

/** 管理者のグループ。packages/app の lib/auth/admin.ts の ADMIN_GROUP と同じ(両方のテストで値を固定している) */
export const ADMIN_GROUP_NAME = "admins";
/** packages/app の lib/auth/password.ts と同じ(両方のテストで値を固定している) */
export const PASSWORD_MIN_LENGTH = 12;
/** packages/app の lib/auth/session.ts の REFRESH_TOKEN_DAYS と同じ(同上) */
export const REFRESH_TOKEN_DAYS = 30;
/**
 * 管理者が作ったユーザーに発行される仮パスワードの有効日数。アプリは作らないが、仮パスワードのまま
 * 使い始めていないユーザーの扱いが変わらないよう、値を明示して固定する。
 */
export const TEMP_PASSWORD_DAYS = 7;
/**
 * アプリの Lambda が使う、Cognito の管理 API。最小の権限として、WebStack が Lambda にこの UserPool に限って与える。
 * 一覧と無効化は管理者の画面(packages/app の lib/auth/user-admin.ts)、状態の確認と削除は登録し直し
 * (確認がまだのアカウントだけを消す)が使う。
 */
export const USER_ADMIN_ACTIONS = [
  "cognito-idp:ListUsers",
  "cognito-idp:AdminDisableUser",
  "cognito-idp:AdminGetUser",
  "cognito-idp:AdminDeleteUser",
];

type Props = StackProps & { stackPrefix: string };

/** 認証。メールアドレスで登録して使う Cognito UserPool と、管理者のグループ(Identity Pool は作らない)。 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${props.stackPrefix}-users`,
      // 利用者が自分で登録する(登録の確認は、メールの確認コードで行う)
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // 確認コードのメール。登録の確認とパスワードの再設定の両方で、同じ文面が使われる。
      // 有効期間は Cognito の固定(登録の確認は 24 時間、パスワードの再設定は 1 時間)
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
        emailSubject: "【もくもく問題集】確認コード",
        emailBody: [
          "もくもく問題集の確認コードをお送りします。画面の案内に沿って入力してください。",
          "",
          "確認コード: {####}",
          "",
          "確認コードの有効期限は、新規登録の確認では 24 時間、パスワードの再設定では 1 時間です。",
          "心当たりがない場合は、このメールを破棄してください(登録は完了せず、パスワードも変わりません)。",
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
      description: "管理者(利用者の一覧・無効化などの管理操作ができる)",
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
