import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_ADMIN_PHRASE,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
  fakeSub,
} from "../src/lib/auth/fake.ts";
import { ownerTag } from "../src/lib/owner-tag.ts";

// 画面をまたぐ退行を見つけるための、主要な流れの通し確認(ログイン → 資格の一覧 → 出題 → 結果)。
// 履歴の保存先(DynamoDB)には接続しないので、履歴の API は、ブラウザの側で受けて応じる。保存の処理は単体・統合テストで確かめる。

async function stubHistory(page: Page) {
  const saved: unknown[] = [];
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
  await page.route("**/api/history/**", (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname === "/api/history/results" && request.method() === "POST") {
      saved.push(request.postDataJSON());
      return route.fulfill(json({}));
    }
    // 保存した結果だけ返す。ほかの読み込みは失敗にして、画面は初期の状態で開く
    if (pathname === "/api/history/results") return route.fulfill(json({ results: saved }));
    if (pathname === "/api/history/result") return route.fulfill(json({ result: saved.at(-1) }));
    return route.fulfill(json({}, 503));
  });
}

// 読み込みが終わる前に押すと、フォームがページごと送信されてしまう。React が受け持つまで待つ
async function openLogin(page: Page) {
  await page.goto("/login");
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form !== null && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
}

async function login(page: Page, email = FAKE_USER_EMAIL, phrase = FAKE_USER_PHRASE) {
  await openLogin(page);
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(phrase);
  await page.getByRole("button", { name: "ログインする" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// 先頭の選択肢を選びながら、最後の問題まで進んで採点する(正誤は問わない)
async function answerAndFinish(page: Page) {
  await expect(page.getByRole("progressbar", { name: "進み具合" })).toBeVisible();
  for (let i = 0; i < 20; i++) {
    const choice = page.locator("input[type=radio], input[type=checkbox]").first();
    if (await choice.count()) await choice.check({ force: true });
    if (await page.getByRole("button", { name: "採点する" }).count()) break;
    await page.getByRole("button", { name: /次の問題へ|回答せずに次へ/ }).click();
  }
  await page.getByRole("button", { name: "採点する" }).click();
  // 確認がある場合は、確定する
  if (page.url().includes("/play"))
    await page
      .getByRole("button", { name: /採点する|はい|確定/ })
      .last()
      .click();
}

test("未ログイン_ログインの画面へ送られる", async ({ page }) => {
  await page.goto("/exams");
  await expect(page).toHaveURL(/\/login\?next=%2Fexams/);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
});

test("以前の試験コードの URL_新しいコードの URL へ永続的に転送され、問い合わせも引き継がれる", async ({ request }) => {
  const response = await request.get("/exams/SAMPLE/result?at=2026-10-01", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(new URL(response.headers().location ?? "", "http://localhost").pathname).toBe("/exams/EX-SMP-XX/result");
  expect(response.headers().location).toContain("at=2026-10-01");
});

test("誤ったパスワード_ログインできず、理由を示す", async ({ page }) => {
  await openLogin(page);
  await page.getByLabel("メールアドレス").fill(FAKE_USER_EMAIL);
  await page.getByLabel("パスワード").fill("wrong-Password-000");
  await page.getByRole("button", { name: "ログインする" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("資格の一覧から出題と結果まで_通して進める", async ({ page }) => {
  await stubHistory(page);
  await login(page);

  await page.goto("/exams");
  await page
    .getByRole("link", { name: /サンプル資格\(動作確認用\)/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX$/);

  // 読み込みが終わる前の押下は効かないので、選ばれるまで押し直す
  const normal = page.getByRole("button", { name: "通常出題" });
  await expect(async () => {
    await normal.click();
    await expect(normal).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
  }).toPass();
  await page.getByRole("button", { name: "出題を始める" }).click();
  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/play/);

  await answerAndFinish(page);

  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/result/);
  await expect(page.locator("main")).toContainText("正答");
});

test("セクションの進捗_別の端末(保存のない新しいブラウザ)でログインしても、同じ進捗が見える", async ({ browser }) => {
  const first = await browser.newContext();
  const page = await first.newPage();
  await login(page);
  await page.goto("/exams/EX-SMP-XX/sections");
  const start = page.getByRole("button", { name: "セクション 1 を解く" });
  await expect(async () => {
    await start.click();
    await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/play/, { timeout: 3_000 });
  }).toPass();
  // 進捗の保存は、結果の画面へ移るときに、待たずに送られる。保存が終わる前に最初のブラウザを閉じると、送信が切れる
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PUT" && new URL(response.url()).pathname === "/api/history/sections",
  );
  await answerAndFinish(page);
  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/result/);
  await saved;
  await first.close();

  // 端末の保存(localStorage)を持たない、別のブラウザの状態
  const second = await browser.newContext();
  const other = await second.newPage();
  await login(other);
  await other.goto("/exams/EX-SMP-XX/sections");
  const firstCard = other.getByRole("listitem").filter({ hasText: "セクション 1" }).first();
  await expect(firstCard).toBeVisible();
  await expect(firstCard).not.toContainText("未挑戦");
  await second.close();
});

test("以前の試験コードで保存した端末の記録_転送後の画面に引き継がれ、旧いキーは消える", async ({ page }) => {
  await login(page);
  const owner = ownerTag(fakeSub(FAKE_USER_EMAIL));
  const record = { correct: 5, total: 5, finishedAt: "2026-10-01T00:00:00.000Z" };
  await page.evaluate(
    ({ key, best }) => {
      localStorage.setItem(key, JSON.stringify({ examCode: "SAMPLE", best: { "0": best } }));
    },
    { key: `mokumoku:v1:${owner}:sections:SAMPLE`, best: record },
  );
  await page.goto("/exams/SAMPLE/sections");
  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/sections/);
  await expect(page.getByRole("listitem").filter({ hasText: "セクション 1" }).first()).toContainText("満点");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes(":sections:")));
  expect(keys).toEqual([`mokumoku:v1:${owner}:sections:EX-SMP-XX`]);
});

test("持ち主の印のない端末の記録_読まずに消え、アカウントへ取り込まれない", async ({ page, context }) => {
  await login(page);
  // ほかの試験が解かないセクションの番号で置く(読まれて取り込まれたら、アカウントの進捗に現れる)
  await page.evaluate(() => {
    const best = { "99": { correct: 5, total: 5, finishedAt: "2026-10-01T00:00:00.000Z" } };
    localStorage.setItem("mokumoku:v1:sections:EX-SMP-XX", JSON.stringify({ examCode: "EX-SMP-XX", best }));
  });
  await page.goto("/exams/EX-SMP-XX/sections");
  await page.waitForLoadState("networkidle");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes(":sections:")));
  expect(keys).not.toContain("mokumoku:v1:sections:EX-SMP-XX");
  expect(await serverSectionBest(context)).not.toHaveProperty("99");
});

/** アカウントのセクションの進捗(サーバーに保存したもの)。セクションの番号ごとの記録 */
async function serverSectionBest(context: BrowserContext): Promise<Record<string, unknown>> {
  const response = await context.request.get("/api/history/sections?examCode=EX-SMP-XX");
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { progress: { best: Record<string, unknown> } };
  return body.progress.best;
}

/**
 * アカウント A(利用者)でセクション 1 を解き、通常出題を途中まで進めて、同じブラウザの状態のまま、
 * `switchAccount` で A のログインを終えてから、アカウント B(管理者)でログインする。
 * A の進捗と出題の途中が、B の画面に出ず、B のアカウントにも保存されないことを確かめる。
 */
async function switchAccountsInSameBrowser(browser: Browser, switchAccount: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const ownerA = ownerTag(fakeSub(FAKE_USER_EMAIL));
  const ownerB = ownerTag(fakeSub(FAKE_ADMIN_EMAIL));

  // A: セクション 1 を解き、通常出題を途中まで進める
  await login(page);
  await page.goto("/exams/EX-SMP-XX/sections");
  const start = page.getByRole("button", { name: "セクション 1 を解く" });
  await expect(async () => {
    await start.click();
    await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/play/, { timeout: 3_000 });
  }).toPass();
  await answerAndFinish(page);
  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/result/);
  await page.goto("/exams/EX-SMP-XX");
  const normal = page.getByRole("button", { name: "通常出題" });
  await expect(async () => {
    await normal.click();
    await expect(normal).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
  }).toPass();
  await page.getByRole("button", { name: "出題を始める" }).click();
  await expect(page).toHaveURL(/\/exams\/EX-SMP-XX\/play/);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "前回の続き" })).toBeVisible();
  const keysOfA = await page.evaluate(() => Object.keys(localStorage));
  expect(keysOfA).toContain(`mokumoku:v1:${ownerA}:session:EX-SMP-XX`);
  expect(keysOfA).toContain(`mokumoku:v1:${ownerA}:sections:EX-SMP-XX`);

  // 同じブラウザの状態(端末の記録はそのまま)で、B に切り替える
  await switchAccount(page);
  await login(page, FAKE_ADMIN_EMAIL, FAKE_ADMIN_PHRASE);

  // B: 「前回の続き」に、A の出題の途中が出ない
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "前回の続き" })).toHaveCount(0);

  // B: セクションの一覧に、A の進捗が出ず、B のアカウントにも取り込まれない
  await page.goto("/exams/EX-SMP-XX/sections");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("listitem").filter({ hasText: "セクション 1" }).first()).toContainText("未挑戦");
  // B: モード選択に、A の出題の途中(続きから解く)が出ない
  await page.goto("/exams/EX-SMP-XX");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "前回の続きから" })).toHaveCount(0);
  expect(await serverSectionBest(context)).toEqual({});

  // 端末の記録: A の分は A のキーに残り、B のキーには A の記録が入らない
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain(`mokumoku:v1:${ownerA}:session:EX-SMP-XX`);
  expect(keys).not.toContain(`mokumoku:v1:${ownerB}:session:EX-SMP-XX`);
  const sectionsOfB = await page.evaluate(
    (key) => localStorage.getItem(key),
    `mokumoku:v1:${ownerB}:sections:EX-SMP-XX`,
  );
  expect(sectionsOfB === null ? {} : JSON.parse(sectionsOfB).best).toEqual({});
  await context.close();
}

test("同じブラウザでログアウトして別のアカウントでログイン_前のアカウントの進捗と出題の途中は出ず、保存されない", async ({
  browser,
}) => {
  await switchAccountsInSameBrowser(browser, async (page) => {
    await page.getByRole("button", { name: "ログアウト" }).filter({ visible: true }).first().click();
    await page.waitForURL((url) => url.pathname.startsWith("/login"));
  });
});

test("ログアウトを経ずに別のアカウントでログイン_前のアカウントの進捗と出題の途中は出ず、保存されない", async ({
  browser,
}) => {
  // セッションの期限が切れたときと同じく、ログインの Cookie だけがなくなり、端末の記録は残る
  await switchAccountsInSameBrowser(browser, async (page) => {
    await page.context().clearCookies();
  });
});
