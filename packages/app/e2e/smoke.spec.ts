import { expect, type Page, test } from "@playwright/test";
import { FAKE_USER_EMAIL, FAKE_USER_PHRASE } from "../src/lib/auth/fake.ts";

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

async function login(page: Page) {
  await openLogin(page);
  await page.getByLabel("メールアドレス").fill(FAKE_USER_EMAIL);
  await page.getByLabel("パスワード").fill(FAKE_USER_PHRASE);
  await page.getByRole("button", { name: "ログインする" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("未ログイン_ログインの画面へ送られる", async ({ page }) => {
  await page.goto("/exams");
  await expect(page).toHaveURL(/\/login\?next=%2Fexams/);
  await expect(page.getByRole("heading", { name: "ログイン" })).toBeVisible();
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
  await expect(page).toHaveURL(/\/exams\/SAMPLE$/);

  // 読み込みが終わる前の押下は効かないので、選ばれるまで押し直す
  const normal = page.getByRole("button", { name: "通常出題" });
  await expect(async () => {
    await normal.click();
    await expect(normal).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
  }).toPass();
  await page.getByRole("button", { name: "出題を始める" }).click();
  await expect(page).toHaveURL(/\/exams\/SAMPLE\/play/);

  // 先頭の選択肢を選びながら、最後の問題まで進む(正誤は問わない)
  const progress = page.getByRole("progressbar", { name: "進み具合" });
  await expect(progress).toBeVisible();
  for (let i = 0; i < 20; i++) {
    const choice = page.locator("input[type=radio], input[type=checkbox]").first();
    if (await choice.count()) await choice.check({ force: true });
    const finish = page.getByRole("button", { name: "採点する" });
    if (await finish.count()) break;
    await page.getByRole("button", { name: /次の問題へ|回答せずに次へ/ }).click();
  }
  await page.getByRole("button", { name: "採点する" }).click();

  // 確認がある場合は、確定する
  const confirm = page.getByRole("button", { name: /採点する|はい|確定/ }).last();
  if (page.url().includes("/play")) await confirm.click();

  await expect(page).toHaveURL(/\/exams\/SAMPLE\/result/);
  await expect(page.locator("main")).toContainText("正答");
});
