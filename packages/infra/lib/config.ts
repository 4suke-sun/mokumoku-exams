/** cdkd(と AWS SDK)が読む変数。コードでは使わないが、.env に置く。 */
export const TOOL_VARIABLES = ["AWS_PROFILE", "AWS_REGION"] as const;
/** 値が必須の変数 */
export const REQUIRED_VARIABLES = ["WEB_ADAPTER_LAYER_ARN", "ORIGIN_VERIFY_VALUE"] as const;
/** 省略できる変数 */
export const OPTIONAL_VARIABLES = ["STACK_PREFIX", "ALARM_EMAIL"] as const;

/** .env.example に載せる変数の全体。載せる変数と、ここの一覧が食い違わないことをテストで確かめる。 */
export const ENV_VARIABLES = [...TOOL_VARIABLES, ...REQUIRED_VARIABLES, ...OPTIONAL_VARIABLES] as const;

export type InfraConfig = {
  /** リソース名の先頭に付ける文字列 */
  stackPrefix: string;
  /** Lambda Web Adapter のレイヤーの ARN(リージョンごとに異なる) */
  webAdapterLayerArn: string;
  /** CloudFront がオリジンへ付ける合言葉。アプリが、この値のないリクエストを断る */
  originVerifyValue: string;
  /** アラームの通知先のメールアドレス。なければ、通知先は作らない(アラームの状態は画面で確かめる) */
  alarmEmail?: string;
};

export type Env = Record<string, string | undefined>;

const DEFAULT_STACK_PREFIX = "mokumoku-exams";
const STACK_PREFIX = /^[A-Za-z][A-Za-z0-9-]{0,30}$/;
const LAYER_ARN = /^arn:aws:lambda:[a-z0-9-]+:\d{12}:layer:[A-Za-z0-9_-]+:\d+$/;
const MIN_ORIGIN_VERIFY_LENGTH = 32;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 環境変数からインフラの設定を作る。
 * 値は環境固有または秘密なので、エラーには変数の名前だけを書き、値は書かない。
 */
export function loadConfig(env: Env): InfraConfig {
  const problems: string[] = [];

  const missing = REQUIRED_VARIABLES.filter((name) => !env[name]);
  for (const name of missing) problems.push(`${name} が設定されていません`);

  const stackPrefix = env.STACK_PREFIX || DEFAULT_STACK_PREFIX;
  if (!STACK_PREFIX.test(stackPrefix)) {
    problems.push("STACK_PREFIX は、英字で始まる 31 文字以内の英数字とハイフンにしてください");
  }

  const webAdapterLayerArn = env.WEB_ADAPTER_LAYER_ARN ?? "";
  if (webAdapterLayerArn && !LAYER_ARN.test(webAdapterLayerArn)) {
    problems.push("WEB_ADAPTER_LAYER_ARN は、Lambda レイヤーの ARN(バージョン付き)にしてください");
  }

  const originVerifyValue = env.ORIGIN_VERIFY_VALUE ?? "";
  if (originVerifyValue && originVerifyValue.length < MIN_ORIGIN_VERIFY_LENGTH) {
    problems.push(`ORIGIN_VERIFY_VALUE は ${MIN_ORIGIN_VERIFY_LENGTH} 文字以上にしてください`);
  }

  const alarmEmail = env.ALARM_EMAIL || undefined;
  if (alarmEmail && !EMAIL.test(alarmEmail)) {
    problems.push("ALARM_EMAIL は、メールアドレスの形にしてください");
  }

  if (problems.length > 0) {
    throw new Error(`.env の設定に問題があります:\n- ${problems.join("\n- ")}`);
  }
  return { stackPrefix, webAdapterLayerArn, originVerifyValue, alarmEmail };
}
