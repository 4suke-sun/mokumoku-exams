/** cdkd(と AWS SDK)と、デプロイ直後のスモーク(scripts/smoke.ts)が読む変数。インフラのコードでは使わないが、.env に置く。 */
export const TOOL_VARIABLES = ["AWS_PROFILE", "AWS_REGION", "FUNCTION_URL"] as const;
/** 値が必須の変数 */
export const REQUIRED_VARIABLES = ["WEB_ADAPTER_LAYER_ARN", "ORIGIN_VERIFY_VALUE"] as const;
/** 省略できる変数 */
export const OPTIONAL_VARIABLES = [
  "STACK_PREFIX",
  "ALARM_EMAIL",
  "APP_RESERVED_CONCURRENCY",
  "SITE_URL",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY_PARAMETER",
  "VAPID_SUBJECT",
  "FEEDBACK_GITHUB_APP_ID",
  "FEEDBACK_GITHUB_INSTALLATION_ID",
  "FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER",
  "DOMAIN_NAME",
  "CERTIFICATE_ARN",
  "HOSTED_ZONE_ID",
  "BUDGET_MONTHLY_USD",
  "BUDGET_EMAIL",
] as const;

/**
 * プッシュ通知の公開鍵、秘密鍵を置いた SSM パラメーターの名前、連絡先。3 つそろえて設定する(どれかだけは不可)。
 * 秘密鍵の値そのものは扱わない(SecureString のパラメーターとして、運用者が作る。docs/app/infra.md)。
 */
const VAPID_VARIABLES = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY_PARAMETER", "VAPID_SUBJECT"] as const;

/**
 * 送信フォームの起票に使う GitHub App の ID、インストールの ID、秘密鍵を置いた SSM パラメーターの名前。3 つそろえて設定する(どれかだけは不可)。
 * 秘密鍵の値そのものは扱わない(SecureString のパラメーターとして、運用者が作る。docs/app/infra.md)。
 */
const FEEDBACK_VARIABLES = [
  "FEEDBACK_GITHUB_APP_ID",
  "FEEDBACK_GITHUB_INSTALLATION_ID",
  "FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER",
] as const;

/** 月の費用の予算の金額(USD)と、知らせる先のメールアドレス。2 つそろえて設定する(どれかだけは不可)。 */
const BUDGET_VARIABLES = ["BUDGET_MONTHLY_USD", "BUDGET_EMAIL"] as const;

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
  /** 公開の URL の起点(`https://<ホスト>`)。sitemap と robots、共有のカードの画像の絶対 URL に使う。なければ sitemap は空で、カードに画像は出ない */
  siteUrl?: string;
  /** プッシュ通知の VAPID の公開鍵、秘密鍵のパラメーターの名前、連絡先。なければ、通知の送信の仕組み(PushStack)を作らない */
  push?: PushConfig;
  /** 送信フォームの起票に使う GitHub App の設定。なければ、起票しない(送信の API は 503) */
  feedback?: FeedbackConfig;
  /** 独自ドメイン。なければ、CloudFront の既定のドメインで配信する */
  customDomain?: CustomDomain;
  /**
   * アプリの Lambda の同時実行の上限(予約する同時実行数)。なければ付けない。
   * アカウントの同時実行の上限から、予約していない分を 100 以上残す必要がある(docs/app/infra.md)
   */
  appReservedConcurrency?: number;
  /** 月の費用の予算。なければ、予算(BudgetStack)を作らない */
  budget?: BudgetConfig;
};

export type BudgetConfig = {
  /** 月の予算の金額(USD)。共通のタグで絞った費用と比べる */
  monthlyUsd: number;
  /** 予算を超えそうなときに知らせるメールアドレス */
  email: string;
};

export type CustomDomain = {
  /** 配信に使うドメイン名 */
  domainName: string;
  /** ドメイン名の証明書(ACM)の ARN。CloudFront の都合で、us-east-1 のもの */
  certificateArn: string;
  /** Route 53 のホストゾーンの ID。あれば、ドメイン名から CloudFront へのレコードを作る(なければ、DNS は自分で設定する) */
  hostedZoneId?: string;
};

export type PushConfig = {
  publicKey: string;
  /** 秘密鍵を置いた SSM パラメーター(SecureString)の名前。値は Lambda が実行時に読む */
  privateKeyParameter: string;
  subject: string;
};

export type FeedbackConfig = {
  /** GitHub App の ID(数字) */
  appId: string;
  /** App のインストールの ID(数字) */
  installationId: string;
  /** App の秘密鍵(PEM)を置いた SSM パラメーター(SecureString)の名前。値は Lambda が実行時に読む */
  privateKeyParameter: string;
};

export type Env = Record<string, string | undefined>;

const DEFAULT_STACK_PREFIX = "mokumoku-exams";
const STACK_PREFIX = /^[A-Za-z][A-Za-z0-9-]{0,30}$/;
const LAYER_ARN = /^arn:aws:lambda:[a-z0-9-]+:\d{12}:layer:[A-Za-z0-9_-]+:\d+$/;
const MIN_ORIGIN_VERIFY_LENGTH = 32;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SITE_URL = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;
// VAPID の公開鍵は base64url(埋め草なし)の 65 バイト(87 文字)
const VAPID_PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/;
// SSM パラメーターの名前。権限をこのパラメーター 1 つの ARN に絞るため、`/` で始まる階層の名前に限る
const SSM_PARAMETER_NAME = /^(?=.{2,1011}$)(\/[A-Za-z0-9_.-]+)+$/;
// GitHub App の ID とインストールの ID は数字
const GITHUB_NUMERIC_ID = /^[0-9]{1,20}$/;
const VAPID_SUBJECT = /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/\S+)$/;
const DOMAIN_NAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// CloudFront に付ける証明書は、us-east-1 に置く必要がある
const CERTIFICATE_ARN = /^arn:aws:acm:us-east-1:\d{12}:certificate\/[0-9a-f-]{36}$/;
const HOSTED_ZONE_ID = /^Z[A-Z0-9]{1,31}$/;
// 予算の金額(USD)。小数は 2 桁まで
const BUDGET_AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

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

  const concurrency = env.APP_RESERVED_CONCURRENCY || undefined;
  const appReservedConcurrency = concurrency === undefined ? undefined : Number(concurrency);
  if (
    appReservedConcurrency !== undefined &&
    !(Number.isInteger(appReservedConcurrency) && appReservedConcurrency >= 1 && appReservedConcurrency <= 1000)
  ) {
    problems.push("APP_RESERVED_CONCURRENCY は、1 から 1000 の整数にしてください");
  }

  const siteUrl = env.SITE_URL || undefined;
  if (siteUrl && !SITE_URL.test(siteUrl)) {
    problems.push("SITE_URL は、https://<ホスト> の形(末尾のスラッシュとパスなし)にしてください");
  }

  const vapidSet = VAPID_VARIABLES.filter((name) => env[name]);
  let push: PushConfig | undefined;
  if (vapidSet.length > 0 && vapidSet.length < VAPID_VARIABLES.length) {
    problems.push(`${VAPID_VARIABLES.join(" / ")} は、3 つそろえて設定してください`);
  } else if (vapidSet.length === VAPID_VARIABLES.length) {
    push = {
      publicKey: env.VAPID_PUBLIC_KEY ?? "",
      privateKeyParameter: env.VAPID_PRIVATE_KEY_PARAMETER ?? "",
      subject: env.VAPID_SUBJECT ?? "",
    };
    if (!VAPID_PUBLIC_KEY.test(push.publicKey))
      problems.push("VAPID_PUBLIC_KEY は、VAPID の公開鍵(base64url)にしてください");
    if (!SSM_PARAMETER_NAME.test(push.privateKeyParameter)) {
      problems.push("VAPID_PRIVATE_KEY_PARAMETER は、`/` で始まる SSM パラメーターの名前にしてください");
    }
    if (!VAPID_SUBJECT.test(push.subject))
      problems.push("VAPID_SUBJECT は、mailto: か https:// で始まる連絡先にしてください");
  }

  const feedback = loadFeedback(env, problems);
  const customDomain = loadCustomDomain(env, problems);
  const budget = loadBudget(env, problems);

  if (problems.length > 0) {
    throw new Error(`.env の設定に問題があります:\n- ${problems.join("\n- ")}`);
  }
  return {
    stackPrefix,
    webAdapterLayerArn,
    originVerifyValue,
    alarmEmail,
    ...(siteUrl ? { siteUrl } : {}),
    ...(appReservedConcurrency !== undefined ? { appReservedConcurrency } : {}),
    ...(push ? { push } : {}),
    ...(feedback ? { feedback } : {}),
    ...(customDomain ? { customDomain } : {}),
    ...(budget ? { budget } : {}),
  };
}

/** 送信フォームの GitHub App の設定。3 つそろえて渡す。どれもなければ、起票しない。 */
function loadFeedback(env: Env, problems: string[]): FeedbackConfig | undefined {
  const set = FEEDBACK_VARIABLES.filter((name) => env[name]);
  if (set.length === 0) return undefined;
  if (set.length < FEEDBACK_VARIABLES.length) {
    problems.push(`${FEEDBACK_VARIABLES.join(" / ")} は、3 つそろえて設定してください`);
    return undefined;
  }
  const feedback = {
    appId: env.FEEDBACK_GITHUB_APP_ID ?? "",
    installationId: env.FEEDBACK_GITHUB_INSTALLATION_ID ?? "",
    privateKeyParameter: env.FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER ?? "",
  };
  if (!GITHUB_NUMERIC_ID.test(feedback.appId)) problems.push("FEEDBACK_GITHUB_APP_ID は、数字にしてください");
  if (!GITHUB_NUMERIC_ID.test(feedback.installationId)) {
    problems.push("FEEDBACK_GITHUB_INSTALLATION_ID は、数字にしてください");
  }
  if (!SSM_PARAMETER_NAME.test(feedback.privateKeyParameter)) {
    problems.push("FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER は、`/` で始まる SSM パラメーターの名前にしてください");
  }
  return feedback;
}

/** 月の費用の予算。金額と宛先はそろえて渡す。どちらもなければ、予算を作らない。 */
function loadBudget(env: Env, problems: string[]): BudgetConfig | undefined {
  const set = BUDGET_VARIABLES.filter((name) => env[name]);
  if (set.length === 0) return undefined;
  if (set.length < BUDGET_VARIABLES.length) {
    problems.push(`${BUDGET_VARIABLES.join(" / ")} は、そろえて設定してください`);
    return undefined;
  }
  const amount = env.BUDGET_MONTHLY_USD ?? "";
  const monthlyUsd = Number(amount);
  if (!BUDGET_AMOUNT.test(amount) || !(monthlyUsd > 0)) {
    problems.push("BUDGET_MONTHLY_USD は、0 より大きい金額(USD。小数は 2 桁まで)にしてください");
  }
  const email = env.BUDGET_EMAIL ?? "";
  if (!EMAIL.test(email)) problems.push("BUDGET_EMAIL は、メールアドレスの形にしてください");
  return { monthlyUsd, email };
}

/** 独自ドメインの設定。ドメイン名と証明書はそろえて渡す。ホストゾーンは、ドメイン名があるときだけ使う。 */
function loadCustomDomain(env: Env, problems: string[]): CustomDomain | undefined {
  const domainName = env.DOMAIN_NAME || undefined;
  const certificateArn = env.CERTIFICATE_ARN || undefined;
  const hostedZoneId = env.HOSTED_ZONE_ID || undefined;

  if (!domainName) {
    if (certificateArn || hostedZoneId) {
      problems.push("CERTIFICATE_ARN と HOSTED_ZONE_ID は、DOMAIN_NAME と一緒に設定してください");
    }
    return undefined;
  }
  if (!DOMAIN_NAME.test(domainName)) {
    problems.push("DOMAIN_NAME は、小文字のドメイン名(例: app.example.com)にしてください");
  }
  if (!certificateArn) {
    problems.push("DOMAIN_NAME を設定したときは、CERTIFICATE_ARN も設定してください");
  } else if (!CERTIFICATE_ARN.test(certificateArn)) {
    problems.push("CERTIFICATE_ARN は、us-east-1 の ACM の証明書の ARN にしてください");
  }
  if (hostedZoneId && !HOSTED_ZONE_ID.test(hostedZoneId)) {
    problems.push("HOSTED_ZONE_ID は、Route 53 のホストゾーンの ID にしてください");
  }
  return { domainName, certificateArn: certificateArn ?? "", hostedZoneId };
}
