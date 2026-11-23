#!/usr/bin/env node
/**
 * デプロイ直後の自動のスモーク。この PC のローカルだけで動かす(AWS の認証がローカルにあるため。CI からは行わない)。
 *   node scripts/smoke.ts                認証が要らない経路と、使い捨てのユーザーによる認証つきの範囲
 *   node scripts/smoke.ts --unauth-only  認証が要らない経路だけ
 * 配信のドメインは `.env` の SITE_URL から得る。Function URL への直接のアクセスは、FUNCTION_URL があるときだけ確かめる。
 * 使い捨てのユーザーは、実行のたびに作り、成功しても失敗しても消す。パスワード・トークン・Cookie の値・メールアドレスは、
 * 出力にも記録にも出さない(エラーも、名前だけを書く)。結果は、項目・成否・属性だけを表で出す。
 */
import { randomBytes } from "node:crypto";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUserPoolsCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { type Browser, chromium, type Page } from "@playwright/test";
import {
  checkCookieAttributes,
  disposableEmail,
  disposablePassword,
  formatSmokeTable,
  judgeUnauthenticated,
  type SmokeItem,
  withDisposableUser,
} from "./lib/smoke-plan.ts";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch (error) {
  if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
}

const args = process.argv.slice(2);
if (args.some((a) => a !== "--unauth-only")) {
  process.stderr.write("使い方: node scripts/smoke.ts [--unauth-only]\n");
  process.exit(2);
}
const items: SmokeItem[] = [];
const finish = (): never => {
  process.stdout.write(`${formatSmokeTable(items)}\n`);
  process.exit(items.some((i) => i.status === "fail") ? 1 : 0);
};

const site = process.env.SITE_URL?.replace(/\/$/, "") ?? "";
if (!site) {
  items.push({ name: "自動のスモーク", status: "skip", note: "SITE_URL が未設定のため、人の確認の一覧に入れる" });
  finish();
}

const status = async (url: string): Promise<number> => (await fetch(url, { redirect: "manual" })).status;

/** 項目の結果を記録する。失敗は、例外の名前だけを書く(メッセージには、画面の内容が入りうる)。 */
async function step(name: string, run: () => Promise<string>): Promise<void> {
  try {
    items.push({ name, status: "ok", note: await run() });
  } catch (error) {
    items.push({ name, status: "fail", note: `失敗(${(error as Error).name})` });
  }
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form !== null && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログインする" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}

async function answerAndFinish(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const choice = page.locator("input[type=radio], input[type=checkbox]").first();
    if (await choice.count()) await choice.check({ force: true });
    if (await page.getByRole("button", { name: "採点する" }).count()) break;
    await page.getByRole("button", { name: /次の問題へ|回答せずに次へ/ }).click();
  }
  await page.getByRole("button", { name: "採点する" }).click();
  if (page.url().includes("/play"))
    await page
      .getByRole("button", { name: /採点する|はい|確定/ })
      .last()
      .click();
}

async function authenticated(browser: Browser, email: string, password: string): Promise<void> {
  const context = await browser.newContext({ baseURL: site, locale: "ja-JP" });
  const page = await context.newPage();
  try {
    await step("サインインとサインアウトと再サインイン", async () => {
      await signIn(page, email, password);
      await page.getByRole("button", { name: "ログアウト" }).filter({ visible: true }).first().click();
      await page.waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 30_000 });
      await signIn(page, email, password);
      return "3 つの操作が通った";
    });
    await step("出題から結果と、履歴の保存と読み出し", async () => {
      await page.goto("/exams");
      const exam = page.locator('a[href^="/exams/"]').first();
      await exam.waitFor();
      await exam.click();
      await page.getByRole("button", { name: "通常出題" }).click();
      await page.getByRole("button", { name: "出題を始める" }).click();
      await page.waitForURL(/\/play/, { timeout: 30_000 });
      await answerAndFinish(page);
      await page.waitForURL(/\/result/, { timeout: 30_000 });
      const examCode = /^\/exams\/([^/]+)/.exec(new URL(page.url()).pathname)?.[1] ?? "";
      const response = await page.request.get(`/api/history/results?examCode=${encodeURIComponent(examCode)}`);
      const body = (await response.json()) as { results?: unknown[] };
      if (response.status() !== 200 || !Array.isArray(body.results) || body.results.length < 1)
        throw new Error("履歴を読み出せない");
      return "結果まで進み、保存した履歴を読み出せた(件数だけ確認)";
    });
    const cookies = await context.cookies();
    items.push(
      checkCookieAttributes(
        cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite })),
      ),
    );
    await step("退会", async () => {
      await page.goto("/account");
      await page.getByRole("button", { name: "退会する…" }).click();
      await page.getByLabel("パスワード", { exact: true }).fill(password);
      await page.getByRole("button", { name: "退会する", exact: true }).click();
      await page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 });
      await signIn(page, email, password).then(
        () => {
          throw new Error("退会のあとも、同じ資格情報でログインできた");
        },
        (error: Error) => {
          if (error.message.startsWith("退会のあとも")) throw error;
        },
      );
      return "退会し、同じ資格情報ではログインできない";
    });
  } finally {
    await context.close();
  }
}

async function main(): Promise<void> {
  items.push(
    ...judgeUnauthenticated({
      login: await status(`${site}/login`),
      api: await status(`${site}/api/history/results`),
      direct: process.env.FUNCTION_URL ? await status(`${process.env.FUNCTION_URL.replace(/\/$/, "")}/login`) : null,
    }),
  );
  if (args.includes("--unauth-only")) return;

  const cognito = new CognitoIdentityProviderClient({});
  const prefix = process.env.STACK_PREFIX || "mokumoku-exams";
  let poolId = "";
  for (let next: string | undefined; ; ) {
    const page = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60, NextToken: next }));
    poolId = page.UserPools?.find((p) => p.Name === `${prefix}-users`)?.Id ?? poolId;
    next = page.NextToken;
    if (poolId || !next) break;
  }
  if (!poolId) {
    items.push({ name: "認証つきの範囲", status: "fail", note: "UserPool が見つからない" });
    return;
  }

  const email = disposableEmail(Date.now(), randomBytes(4).toString("hex"));
  const password = disposablePassword(randomBytes(12).toString("hex"));
  const browser = await chromium.launch();
  const outcome = await withDisposableUser(
    {
      create: async (e) => {
        await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: poolId,
            Username: e,
            MessageAction: "SUPPRESS",
            UserAttributes: [
              { Name: "email", Value: e },
              { Name: "email_verified", Value: "true" },
            ],
          }),
        );
      },
      // 仮設定のままだと、サインインが新しいパスワードの要求で止まる
      setPassword: async (e, p) => {
        await cognito.send(
          new AdminSetUserPasswordCommand({ UserPoolId: poolId, Username: e, Password: p, Permanent: true }),
        );
      },
      remove: async (e) => {
        try {
          await cognito.send(new AdminDeleteUserCommand({ UserPoolId: poolId, Username: e }));
        } catch (error) {
          // 退会で消えていれば、残っていない
          if ((error as Error).name !== "UserNotFoundException") throw error;
        }
      },
    },
    email,
    password,
    () => authenticated(browser, email, password),
  );
  await browser.close();
  if (outcome.error)
    items.push({ name: "認証つきの範囲", status: "fail", note: `失敗(${(outcome.error as Error).name})` });
  items.push(
    outcome.removeError
      ? { name: "使い捨てのユーザーの後始末", status: "fail", note: "消せなかった。人が UserPool を確かめて消す" }
      : { name: "使い捨てのユーザーの後始末", status: "ok", note: "消した(退会で消えていてもよい)" },
  );
}

main()
  .catch((error: Error) => items.push({ name: "実行", status: "fail", note: `例外(${error.name})` }))
  .finally(finish);
