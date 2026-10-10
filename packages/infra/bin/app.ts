import { resolve } from "node:path";
import { App } from "aws-cdk-lib";
import { AuthStack } from "../lib/auth-stack.ts";
import { loadConfig } from "../lib/config.ts";
import { WebStack } from "../lib/web-stack.ts";

const config = loadConfig(process.env);
const repoRoot = resolve(import.meta.dirname, "../../..");
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION,
};

const app = new App();
new AuthStack(app, `${config.stackPrefix}-auth`, { env, stackPrefix: config.stackPrefix });
new WebStack(app, `${config.stackPrefix}-web`, {
  env,
  config,
  lambdaCodePath: resolve(repoRoot, "dist/lambda"),
  staticAssetsPath: resolve(repoRoot, "dist/static"),
});
