import { CfnOutput, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type { Construct } from "constructs";

export const ADMIN_GROUP_NAME = "admins";

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
      passwordPolicy: {
        minLength: 12,
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
      authFlows: { userSrp: true },
      // ホスト画面(OAuth)は使わない。暗黙的フローなどが、既定で有効にならないようにする
      disableOAuth: true,
      preventUserExistenceErrors: true,
    });

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
  }
}
