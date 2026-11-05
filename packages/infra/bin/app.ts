import { resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack.ts";
import { BudgetStack } from "../lib/budget-stack.ts";
import { loadConfig } from "../lib/config.ts";
import { DataStack } from "../lib/data-stack.ts";
import { PushStack } from "../lib/push-stack.ts";
import { addCommonTags } from "../lib/tags.ts";
import { WebStack } from "../lib/web-stack.ts";

const config = loadConfig(process.env);
const repoRoot = resolve(import.meta.dirname, "../../..");
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION,
};

const app = new App();
// すべてのスタックとリソースに、共通のタグ(Service)を付ける
addCommonTags(app);
const auth = new AuthStack(app, `${config.stackPrefix}-auth`, { env, stackPrefix: config.stackPrefix });
const data = new DataStack(app, `${config.stackPrefix}-data`, { env });
const web = new WebStack(app, `${config.stackPrefix}-web`, {
  env,
  config,
  lambdaCodePath: resolve(repoRoot, "dist/lambda"),
  staticAssetsPath: resolve(repoRoot, "dist/static"),
  publicAssetsPath: resolve(repoRoot, "dist/public"),
  userPoolClientId: auth.userPoolClient.userPoolClientId,
  userPoolId: auth.userPool.userPoolId,
  userPoolArn: auth.userPool.userPoolArn,
  historyTable: data.table,
});
// 通知の設定(VAPID_*)をそろえたときだけ、毎日の送信の仕組みを作る
if (config.push) {
  new PushStack(app, `${config.stackPrefix}-push`, {
    env,
    config,
    push: config.push,
    pushCodePath: resolve(repoRoot, "dist/push"),
    historyTable: data.table,
    alarmTopic: web.alarmTopic,
  });
}
// 予算の設定(BUDGET_*)をそろえたときだけ、月の費用の予算を作る
if (config.budget) {
  new BudgetStack(app, `${config.stackPrefix}-budget`, { env, stackPrefix: config.stackPrefix, budget: config.budget });
}
