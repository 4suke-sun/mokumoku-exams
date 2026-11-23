/**
 * デプロイ直後の自動のスモーク(scripts/smoke.ts)の判定。副作用のない関数と、依存を引数で受ける後始末の枠にして、単体テストする。
 * 結果は、項目・成否・属性だけを書く。パスワード・トークン・Cookie の値・メールアドレスは、出力にも記録にも出さない。
 */
import { COOKIE_NAMES } from "../../packages/app/src/lib/auth/session.ts";

export interface SmokeItem {
  name: string;
  status: "ok" | "fail" | "skip";
  note: string;
}

const MARK = { ok: "成功", fail: "失敗", skip: "省略" } as const;

export function formatSmokeTable(items: SmokeItem[]): string {
  const rows = items.map((i) => `| ${i.name} | ${MARK[i.status]} | ${i.note} |`);
  return ["| 項目 | 結果 | 内容 |", "| --- | --- | --- |", ...rows].join("\n");
}

/** 使い捨てのユーザーのメールアドレス。予約済みのドメインで、実行ごとに変わる。 */
export const disposableEmail = (now: number, hex: string): string => `smoke-${now}-${hex}@example.com`;

/** 使い捨てのパスワード。大文字・小文字・数字を含み、12 文字以上(UserPool のポリシー)。 */
export const disposablePassword = (hex: string): string => `Sm1${hex}Zz`;

/** 認証が要らない経路の判定。ステータスの数だけを受ける。 */
export function judgeUnauthenticated(input: {
  login: number;
  api: number;
  /** Function URL への直接のアクセス。調べなかったときは null */
  direct: number | null;
}): SmokeItem[] {
  return [
    {
      name: "未ログインの /login",
      status: input.login === 200 ? "ok" : "fail",
      note: input.login === 200 ? "200 で応答" : `200 でない(${input.login})`,
    },
    {
      name: "未ログインの API",
      status: input.api === 401 ? "ok" : "fail",
      note: input.api === 401 ? "401 で断る" : `401 でない(${input.api})`,
    },
    input.direct === null
      ? { name: "Function URL への直接のアクセス", status: "skip", note: "FUNCTION_URL が未設定のため、人が確かめる" }
      : {
          name: "Function URL への直接のアクセス",
          status: input.direct === 403 ? "ok" : "fail",
          note: input.direct === 403 ? "403 で断る" : `403 でない(${input.direct})`,
        },
  ];
}

export interface CookieInfo {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
}

/** Cookie の属性の判定。値は受け取らない。 */
export function checkCookieAttributes(cookies: CookieInfo[]): SmokeItem {
  const problems: string[] = [];
  for (const name of Object.values(COOKIE_NAMES)) {
    const cookie = cookies.find((c) => c.name === name);
    if (!cookie) {
      problems.push(`${name} がない`);
      continue;
    }
    if (!cookie.httpOnly) problems.push(`${name} の HttpOnly がない`);
    if (!cookie.secure) problems.push(`${name} の Secure がない`);
    if (cookie.sameSite !== "Lax") problems.push(`${name} の SameSite が Lax でない`);
  }
  return {
    name: "Cookie の属性",
    status: problems.length === 0 ? "ok" : "fail",
    note: problems.length === 0 ? "3 つとも HttpOnly・SameSite=Lax・Secure" : problems.join(" / "),
  };
}

/** 出力に、隠す値(パスワード・メールアドレスなど)が含まれていない。空の値は数えない。 */
export const containsNoValues = (output: string, values: string[]): boolean =>
  values.filter((v) => v !== "").every((v) => !output.includes(v));

export interface UserDeps {
  create: (email: string) => Promise<void>;
  setPassword: (email: string, password: string) => Promise<void>;
  /** ユーザーがなければ(退会で消えていれば)、何もしない */
  remove: (email: string) => Promise<void>;
}

/**
 * 使い捨てのユーザーを作って使い、成功しても失敗しても消す。作る途中で失敗しても、消しを試みる。
 * 消しの失敗は、使った結果を隠さず、別に知らせる。
 */
export async function withDisposableUser<T>(
  deps: UserDeps,
  email: string,
  password: string,
  run: () => Promise<T>,
): Promise<{ result?: T; error?: unknown; removeError?: unknown }> {
  const out: { result?: T; error?: unknown; removeError?: unknown } = {};
  try {
    await deps.create(email);
    await deps.setPassword(email, password);
    out.result = await run();
  } catch (error) {
    out.error = error;
  }
  try {
    await deps.remove(email);
  } catch (error) {
    out.removeError = error;
  }
  return out;
}

/** 自動で確かめた項目(`docs/post-deploy-smoke.md` の「3. 確認する流れ」の項目名)。成功したときだけ、人の確認の一覧から除く。 */
export const AUTOMATED_CHECKLIST_ITEMS = ["サインイン", "Cookie"] as const;

/** 人の確認の一覧。自動のスモークが全項目成功(失敗も省略もない)のときだけ、自動で確かめた項目を除く。 */
export const humanItemsAfterSmoke = (items: string[], smoke: SmokeItem[]): string[] =>
  smoke.length > 0 && smoke.every((i) => i.status === "ok")
    ? items.filter((i) => !(AUTOMATED_CHECKLIST_ITEMS as readonly string[]).includes(i))
    : items;

/** `formatSmokeTable` の表を、項目に戻す(別のプロセスの出力を読む)。表でない行は読み飛ばす。 */
export function parseSmokeTable(text: string): SmokeItem[] {
  const status = { 成功: "ok", 失敗: "fail", 省略: "skip" } as const;
  const items: SmokeItem[] = [];
  for (const line of text.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const mark = cells[2] as keyof typeof status | undefined;
    if (cells.length >= 5 && cells[0] === "" && mark !== undefined && mark in status)
      items.push({ name: cells[1] ?? "", status: status[mark], note: cells[3] ?? "" });
  }
  return items;
}
