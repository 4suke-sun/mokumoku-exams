import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "@/app/admin/layout.tsx";
import * as adminDisableRoute from "@/app/api/admin/users/disable/route.ts";
import * as adminUsersRoute from "@/app/api/admin/users/route.ts";
import * as changePasswordRoute from "@/app/api/auth/change-password/route.ts";
import * as deleteAccountRoute from "@/app/api/auth/delete-account/route.ts";
import * as feedbackRoute from "@/app/api/feedback/route.ts";
import * as bookmarksRoute from "@/app/api/history/bookmarks/route.ts";
import * as daysRoute from "@/app/api/history/days/route.ts";
import * as goalRoute from "@/app/api/history/goal/route.ts";
import * as prefsRoute from "@/app/api/history/prefs/route.ts";
import * as resultRoute from "@/app/api/history/result/route.ts";
import * as historyRoute from "@/app/api/history/results/route.ts";
import * as reviewAllRoute from "@/app/api/history/review/all/route.ts";
import * as reviewRoute from "@/app/api/history/review/route.ts";
import * as sectionsRoute from "@/app/api/history/sections/route.ts";
import * as statsRoute from "@/app/api/history/stats/route.ts";
import * as pushSubscriptionRoute from "@/app/api/push/subscription/route.ts";
import * as pushTestRoute from "@/app/api/push/test/route.ts";
import * as questionsRoute from "@/app/api/questions/route.ts";
import type { AuditEntry } from "@/lib/admin/audit.ts";
import { isAdminPath } from "@/lib/auth/admin.ts";
import {
  FAKE_ADMIN_EMAIL,
  FAKE_ADMIN_PHRASE,
  FAKE_INVITED_EMAIL,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
  fakeSub,
} from "@/lib/auth/fake.ts";
import { isPublicPath, PUBLIC_AUTH_API_PATHS, PUBLIC_FILE_PATHS, PUBLIC_PAGE_PATHS } from "@/lib/auth/guard.ts";
import { getAuthProvider, getUserAdmin } from "@/lib/auth/index.ts";
import { withTokenCookies } from "@/lib/auth/session.ts";
import { SUB_PATTERN } from "@/lib/auth/verify.ts";
import { getHistoryRepository } from "@/lib/history/repository.ts";
import { getPushRepository } from "@/lib/push/repository.ts";
import { proxy } from "./proxy.ts";

// 認可の網羅テスト。「ログインなしで開けるもの」と「ログインが要るもの」を、一覧として固定する。
// 新しい画面や API を足したときは、この一覧に足すまでテストが落ちる(保護するかどうかを、意識して決めるため)。
// 一覧に載せない限り、新しい経路は保護される(proxy は許可リスト方式)。

// 管理者の画面のレイアウトが読む、リクエストのヘッダー(テストごとに Cookie を差し替える)
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "app");
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

/** ディレクトリを辿り、指定した名前のファイルがある経路(URL のパス)を返す。`[code]` のような動的な部分は例の値にする。 */
function routesOf(fileName: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name === fileName) {
        const segments = relative(APP_DIR, dir)
          .split(sep)
          .filter((s) => s !== "" && !/^\(.*\)$/.test(s))
          .map((s) => (/^\[.+\]$/.test(s) ? "sample" : s));
        found.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(APP_DIR);
  return found.sort();
}

/** Next のメタデータの経路(app 直下のファイル名と、配る経路)。 */
const METADATA_ROUTES: Record<string, string> = {
  "robots.ts": "/robots.txt",
  "sitemap.ts": "/sitemap.xml",
  "manifest.ts": "/manifest.webmanifest",
};

/** ログインなしで取りに来られるファイルの経路(public/ のファイルと、メタデータの経路)。 */
function filesOf(): string[] {
  const found = Object.entries(METADATA_ROUTES)
    .filter(([file]) => existsSync(join(APP_DIR, file)))
    .map(([, path]) => path);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else found.push(`/${relative(PUBLIC_DIR, join(dir, entry.name)).split(sep).join("/")}`);
    }
  };
  if (existsSync(PUBLIC_DIR)) walk(PUBLIC_DIR);
  return found.sort();
}

const PUBLIC_PAGES = ["/forgot-password", "/login", "/privacy", "/signup"];
const PROTECTED_PAGES = [
  "/",
  "/account",
  "/achievements",
  "/admin",
  "/admin/preview",
  "/admin/preview/sample",
  "/admin/preview/sample/code-drill",
  "/admin/preview/sample/code-drill/sample",
  "/admin/preview/sample/notebook",
  "/admin/preview/sample/notebook/sample",
  "/admin/preview/sample/notebook/sample/sample",
  "/bookmarks",
  "/contact",
  "/contact/question",
  "/exams",
  "/exams/sample",
  "/exams/sample/cards",
  "/exams/sample/code-drill",
  "/exams/sample/code-drill/sample",
  "/exams/sample/dashboard",
  "/exams/sample/info",
  "/exams/sample/notebook",
  "/exams/sample/notebook/sample",
  "/exams/sample/notebook/sample/sample",
  "/exams/sample/play",
  "/exams/sample/result",
  "/exams/sample/sections",
  "/exams/sample/study",
  "/exams/sample/study/domains/sample",
  "/exams/sample/study/sample",
  "/help",
  "/release-notes",
  "/review",
];
/** 保護される画面のうち、管理者だけが開けるもの */
const ADMIN_PAGES = [
  "/admin",
  "/admin/preview",
  "/admin/preview/sample",
  "/admin/preview/sample/code-drill",
  "/admin/preview/sample/code-drill/sample",
  "/admin/preview/sample/notebook",
  "/admin/preview/sample/notebook/sample",
  "/admin/preview/sample/notebook/sample/sample",
];
/** 保護される API のうち、管理者だけが呼べるもの */
const ADMIN_APIS = ["/api/admin/users", "/api/admin/users/disable"];
const PUBLIC_APIS = [
  "/api/auth/confirm-sign-up",
  "/api/auth/forgot-password",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/new-password",
  "/api/auth/refresh",
  "/api/auth/resend-code",
  "/api/auth/reset-password",
  "/api/auth/session",
  "/api/auth/sign-up",
];
const PROTECTED_APIS = [
  "/api/admin/users",
  "/api/admin/users/disable",
  "/api/auth/change-password",
  "/api/auth/delete-account",
  "/api/feedback",
  "/api/history/bookmarks",
  "/api/history/days",
  "/api/history/goal",
  "/api/history/notebook",
  "/api/history/prefs",
  "/api/history/sections",
  "/api/history/result",
  "/api/history/results",
  "/api/history/review",
  "/api/history/review/all",
  "/api/history/stats",
  "/api/push/subscription",
  "/api/push/test",
  "/api/questions",
];
const PUBLIC_FILES = [
  "/brand/logo-full.png",
  "/brand/mascot.png",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/manifest.webmanifest",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
];

const request = (path: string, init: { cookie?: string; method?: string; body?: unknown } = {}) =>
  new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

describe("経路の一覧", () => {
  it("画面の経路_一覧と過不足なく一致する(新しい画面は一覧に足すまで落ちる)", () => {
    expect(routesOf("page.tsx")).toEqual([...PUBLIC_PAGES, ...PROTECTED_PAGES].sort());
  });

  it("API の経路_一覧と過不足なく一致する(新しい API は一覧に足すまで落ちる)", () => {
    expect(routesOf("route.ts")).toEqual([...PUBLIC_APIS, ...PROTECTED_APIS].sort());
  });

  it("ログインなしで開ける経路_一覧に挙げた画面と API だけで_ほかはすべて保護される", () => {
    const allPaths = [...routesOf("page.tsx"), ...routesOf("route.ts")];
    const open = allPaths.filter((path) => isPublicPath(path)).sort();
    expect(open).toEqual([...PUBLIC_PAGES, ...PUBLIC_APIS].sort());
    expect(new Set(PUBLIC_AUTH_API_PATHS)).toEqual(new Set(PUBLIC_APIS));
    expect(new Set(PUBLIC_PAGE_PATHS)).toEqual(new Set(PUBLIC_PAGES));
  });

  it("ログインなしで取れるファイル_一覧と過不足なく一致する(新しいファイルは一覧に足すまで落ちる)", () => {
    expect(filesOf()).toEqual(PUBLIC_FILES);
    expect(new Set(PUBLIC_FILE_PATHS)).toEqual(new Set(PUBLIC_FILES));
    for (const path of PUBLIC_FILES) expect(isPublicPath(path), path).toBe(true);
  });

  it("公開のファイルに似た経路_公開にならない", () => {
    for (const path of [
      "/sw.js/",
      "/SW.JS",
      "/icons",
      "/icons/",
      "/icons/other.png",
      "/robots.txt/x",
      "/manifest.json",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("管理者の経路_一覧に挙げた画面と API だけで_ほかの画面と API は含まない", () => {
    const allPaths = [...routesOf("page.tsx"), ...routesOf("route.ts")];
    expect(allPaths.filter((path) => isAdminPath(path)).sort()).toEqual([...ADMIN_PAGES, ...ADMIN_APIS].sort());
    for (const path of ADMIN_PAGES) expect(PROTECTED_PAGES).toContain(path);
    for (const path of ADMIN_APIS) expect(PROTECTED_APIS).toContain(path);
  });

  it("保護される API_公開の一覧に似た経路でも_公開にならない", () => {
    for (const path of [
      "/api/auth",
      "/api/auth/",
      "/api/auth/change-password",
      "/api/auth/delete-account",
      "/api/auth/login/x",
      "/api/history",
    ]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });
});

describe("認可: 未ログインの拒否", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("保護される API_どのメソッドでも入口(proxy)が未ログインを 401 で断る", async () => {
    for (const path of PROTECTED_APIS) {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const response = await proxy(request(path, { method }));
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    }
  });

  it("保護される画面_未ログインはログイン画面へ移す", async () => {
    for (const path of PROTECTED_PAGES) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
    }
  });

  it("公開のファイル_未ログインでも入口(proxy)を通る", async () => {
    for (const path of PUBLIC_FILES) {
      const response = await proxy(request(path));
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.status, path).toBe(200);
    }
  });

  it("偽のトークン_API も画面も開けない", async () => {
    const forged = "mokumoku_id=forged; mokumoku_access=forged";
    for (const path of PROTECTED_APIS) expect((await proxy(request(path, { cookie: forged }))).status).toBe(401);
    for (const path of PROTECTED_PAGES) expect((await proxy(request(path, { cookie: forged }))).status).toBe(307);
  });

  it("履歴の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await historyRoute.GET(request("/api/history/results?examCode=EX-SMP-XX"))).status).toBe(401);
    const response = await historyRoute.POST(
      request("/api/history/results", {
        method: "POST",
        body: {
          examCode: "EX-SMP-XX",
          questionIds: ["SAMPLE-0001"],
          answers: {},
          finishedAt: new Date().toISOString(),
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("ブックマークと復習プールの API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await bookmarksRoute.GET(request("/api/history/bookmarks?examCode=EX-SMP-XX"))).status).toBe(401);
    expect((await reviewRoute.GET(request("/api/history/review?examCode=EX-SMP-XX"))).status).toBe(401);
    const response = await bookmarksRoute.PUT(
      request("/api/history/bookmarks", {
        method: "PUT",
        body: { examCode: "EX-SMP-XX", questionId: "SAMPLE-0001", bookmarked: true },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("1 回分の結果・集計・復習の一覧と外す API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    const at = encodeURIComponent("2026-10-11T12:00:00.000Z");
    expect((await resultRoute.GET(request(`/api/history/result?examCode=EX-SMP-XX&finishedAt=${at}`))).status).toBe(
      401,
    );
    expect((await statsRoute.GET(request("/api/history/stats?examCode=EX-SMP-XX"))).status).toBe(401);
    expect((await reviewAllRoute.GET(request("/api/history/review/all"))).status).toBe(401);
    const removal = { examCode: "EX-SMP-XX", questionId: "SAMPLE-0001" };
    expect((await reviewRoute.DELETE(request("/api/history/review", { method: "DELETE", body: removal }))).status).toBe(
      401,
    );
  });

  it("セクションの進捗の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await sectionsRoute.GET(request("/api/history/sections?examCode=EX-SMP-XX"))).status).toBe(401);
    const response = await sectionsRoute.PUT(
      request("/api/history/sections", { method: "PUT", body: { examCode: "EX-SMP-XX", best: {} } }),
    );
    expect(response.status).toBe(401);
  });

  it("日ごとの学習量と目標日の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await daysRoute.GET(request("/api/history/days?examCode=EX-SMP-XX"))).status).toBe(401);
    expect((await goalRoute.GET(request("/api/history/goal?examCode=EX-SMP-XX"))).status).toBe(401);
    const response = await goalRoute.PUT(
      request("/api/history/goal", { method: "PUT", body: { examCode: "EX-SMP-XX", date: "2026-12-20" } }),
    );
    expect(response.status).toBe(401);
  });

  it("通知の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
      keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
    };
    const path = "/api/push/subscription";
    expect((await pushSubscriptionRoute.PUT(request(path, { method: "PUT", body: subscription }))).status).toBe(401);
    const unsubscribe = { endpoint: subscription.endpoint };
    expect((await pushSubscriptionRoute.DELETE(request(path, { method: "DELETE", body: unsubscribe }))).status).toBe(
      401,
    );
    expect((await pushTestRoute.POST(request("/api/push/test", { method: "POST", body: {} }))).status).toBe(401);
  });

  it("問題の API 本体_入口を通らなくても未ログインを断り_問題と正解を返さない", async () => {
    const response = await questionsRoute.POST(
      request("/api/questions", { method: "POST", body: { examCode: "EX-SMP-XX", questionIds: ["SAMPLE-0001"] } }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("correctAnswers");
  });

  it("送信フォームの API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    const response = await feedbackRoute.POST(
      request("/api/feedback", { method: "POST", body: { form: "contact", category: "bug", text: "x" } }),
    );
    expect(response.status).toBe(401);
  });

  it("パスワード変更の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    const response = await changePasswordRoute.POST(
      request("/api/auth/change-password", {
        method: "POST",
        body: { previousPassword: "x", proposedPassword: "y" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("退会の API 本体_入口を通らなくても未ログインを断り_何も消さない(二重の防御)", async () => {
    for (const cookie of [undefined, "mokumoku_id=forged; mokumoku_access=forged"]) {
      const response = await deleteAccountRoute.POST(
        request("/api/auth/delete-account", { method: "POST", cookie, body: { password: FAKE_USER_PHRASE } }),
      );
      expect(response.status).toBe(401);
    }
    const signedIn = await getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    expect(signedIn.kind).toBe("signed-in");
  });

  it("保護される API_受け付けるメソッドは宣言した分だけ(足したときは認可のテストも足す)", () => {
    const methods = (module: object) => Object.keys(module).filter((k) => /^[A-Z]+$/.test(k));
    expect(methods(historyRoute).sort()).toEqual(["GET", "POST"]);
    expect(methods(bookmarksRoute).sort()).toEqual(["GET", "PUT"]);
    expect(methods(reviewRoute).sort()).toEqual(["DELETE", "GET"]);
    expect(methods(reviewAllRoute)).toEqual(["GET"]);
    expect(methods(resultRoute)).toEqual(["GET"]);
    expect(methods(statsRoute)).toEqual(["GET"]);
    expect(methods(daysRoute)).toEqual(["GET"]);
    expect(methods(goalRoute).sort()).toEqual(["GET", "PUT"]);
    expect(methods(prefsRoute).sort()).toEqual(["GET", "PUT"]);
    expect(methods(sectionsRoute).sort()).toEqual(["GET", "PUT"]);
    expect(methods(changePasswordRoute)).toEqual(["POST"]);
    expect(methods(deleteAccountRoute)).toEqual(["POST"]);
    expect(methods(adminUsersRoute)).toEqual(["GET"]);
    expect(methods(adminDisableRoute)).toEqual(["POST"]);
    expect(methods(pushSubscriptionRoute).sort()).toEqual(["DELETE", "PUT"]);
    expect(methods(pushTestRoute)).toEqual(["POST"]);
    expect(methods(feedbackRoute)).toEqual(["POST"]);
  });
});

describe("認可: 他人のデータに触れない", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
    delete (globalThis as { __mokumokuFakeHistory?: unknown }).__mokumokuFakeHistory;
    delete (globalThis as { __mokumokuFakePush?: unknown }).__mokumokuFakePush;
    delete (globalThis as { __mokumokuFakeFeedback?: unknown }).__mokumokuFakeFeedback;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function cookie(): Promise<string> {
    const signedIn = await getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    return withTokenCookies(null, signedIn.tokens);
  }

  /** 別のアカウント(管理者)のログイン */
  async function adminCookie(): Promise<string> {
    const signedIn = await getAuthProvider().signIn(FAKE_ADMIN_EMAIL, FAKE_ADMIN_PHRASE);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    return withTokenCookies(null, signedIn.tokens);
  }

  const result = () => ({
    examCode: "EX-SMP-XX",
    questionIds: ["SAMPLE-0001"],
    answers: { "SAMPLE-0001": ["A"] },
    finishedAt: new Date().toISOString(),
  });

  it("利用者の識別子を本文・問い合わせ・ヘッダーで渡す_どれも使われず_拒否される", async () => {
    const own = await cookie();
    for (const key of ["sub", "userId", "user", "owner", "PK", "SK", "pk", "sk"]) {
      const response = await historyRoute.POST(
        request("/api/history/results", { method: "POST", cookie: own, body: { ...result(), [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
    for (const key of ["sub", "userId", "user", "owner", "PK"]) {
      const response = await historyRoute.GET(
        request(`/api/history/results?examCode=EX-SMP-XX&${key}=other-user`, { cookie: own }),
      );
      expect(response.status, key).toBe(400);
    }
    const withHeaders = new NextRequest("http://localhost/api/history/results?examCode=EX-SMP-XX", {
      headers: {
        cookie: own,
        "x-user-id": "other-user",
        "x-amzn-oidc-subject": "other-user",
        authorization: "Bearer x",
      },
    });
    const response = await historyRoute.GET(withHeaders);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { results: unknown[] }).results).toEqual([]);
  });

  it("送信フォームで利用者の識別子を本文で渡す_拒否される", async () => {
    const own = await cookie();
    const body = { form: "contact", category: "bug", text: "x" };
    for (const key of ["sub", "userId", "email", "PK", "SK"]) {
      const response = await feedbackRoute.POST(
        request("/api/feedback", { method: "POST", cookie: own, body: { ...body, [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
  });

  it("ブックマークで利用者の識別子を本文・問い合わせで渡す_拒否される", async () => {
    const own = await cookie();
    const change = { examCode: "EX-SMP-XX", questionId: "SAMPLE-0001", bookmarked: true };
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await bookmarksRoute.PUT(
        request("/api/history/bookmarks", { method: "PUT", cookie: own, body: { ...change, [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
    for (const route of [bookmarksRoute, reviewRoute]) {
      const response = await route.GET(
        request("/api/history/bookmarks?examCode=EX-SMP-XX&sub=other-user", { cookie: own }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("目標日と日ごとの学習量で利用者の識別子を本文・問い合わせで渡す_拒否される", async () => {
    const own = await cookie();
    const change = { examCode: "EX-SMP-XX", date: "2026-12-20" };
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await goalRoute.PUT(
        request("/api/history/goal", { method: "PUT", cookie: own, body: { ...change, [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
    for (const [route, path] of [
      [goalRoute, "/api/history/goal"],
      [daysRoute, "/api/history/days"],
    ] as const) {
      const response = await route.GET(request(`${path}?examCode=EX-SMP-XX&sub=other-user`, { cookie: own }));
      expect(response.status, path).toBe(400);
    }
  });

  it("資格コードにキーの区切りを入れて他の区画を読もうとする_断られる", async () => {
    const own = await cookie();
    for (const examCode of [
      "EX-SMP-XX%23",
      "EX-SMP-XX%23USER%23other",
      "%23",
      "USER%23other",
      "EX-SMP-XX%2523",
      "sample",
    ]) {
      const response = await historyRoute.GET(request(`/api/history/results?examCode=${examCode}`, { cookie: own }));
      expect(response.status, examCode).toBe(400);
    }
  });

  it("利用者の識別子にキーの区切りを含むトークン_識別子の形の検査で受け付けない", () => {
    for (const sub of ["a#b", "USER#other", "a b", "", "a/b", "a:b", "a".repeat(129)]) {
      expect(SUB_PATTERN.test(sub), JSON.stringify(sub)).toBe(false);
    }
    for (const sub of ["0f8fad5b-d9cb-469f-a165-70867728950e", "user.name_1-2"]) {
      expect(SUB_PATTERN.test(sub), sub).toBe(true);
    }
  });

  it("ログイン中の利用者_自分の保存先にだけ保存され_取得も自分の分だけ", async () => {
    const own = await cookie();
    const saved = result();
    expect(
      (await historyRoute.POST(request("/api/history/results", { method: "POST", cookie: own, body: saved }))).status,
    ).toBe(200);
    const mine = await historyRoute.GET(request("/api/history/results?examCode=EX-SMP-XX", { cookie: own }));
    expect(((await mine.json()) as { results: unknown[] }).results).toEqual([saved]);
    // ログインしていない人には、何も見えない
    expect((await historyRoute.GET(request("/api/history/results?examCode=EX-SMP-XX"))).status).toBe(401);
  });

  it("ブックマークと復習プール_自分の分だけに保存され_取得も自分の分だけ", async () => {
    const own = await cookie();
    const put = await bookmarksRoute.PUT(
      request("/api/history/bookmarks", {
        method: "PUT",
        cookie: own,
        body: { examCode: "EX-SMP-XX", questionId: "SAMPLE-0002", bookmarked: true },
      }),
    );
    expect(put.status).toBe(200);
    // 不正解の結果を保存すると、その問題が復習プールに入る
    await historyRoute.POST(request("/api/history/results", { method: "POST", cookie: own, body: result() }));
    const bookmarks = await bookmarksRoute.GET(request("/api/history/bookmarks?examCode=EX-SMP-XX", { cookie: own }));
    expect(await bookmarks.json()).toEqual({ questionIds: ["SAMPLE-0002"] });
    const review = await reviewRoute.GET(request("/api/history/review?examCode=EX-SMP-XX", { cookie: own }));
    expect(await review.json()).toEqual({ questionIds: ["SAMPLE-0001"] });
  });

  it("セクションの進捗_利用者の識別子を本文・問い合わせで渡す_拒否される", async () => {
    const own = await cookie();
    const body = { examCode: "EX-SMP-XX", best: {} };
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await sectionsRoute.PUT(
        request("/api/history/sections", { method: "PUT", cookie: own, body: { ...body, [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
    // 公開していない資格・形の違う記録・キーの区切りを含む資格コードは、断る
    const put = (body: unknown) =>
      sectionsRoute.PUT(request("/api/history/sections", { method: "PUT", cookie: own, body }));
    expect((await put({ examCode: "NOPE", best: {} })).status).toBe(400);
    expect((await put({ examCode: "EX-SMP-XX", best: { x: { correct: 1, total: 5, finishedAt: "t" } } })).status).toBe(
      400,
    );
    expect((await put({ examCode: "EX-SMP-XX#1", best: {} })).status).toBe(400);
    const query = await sectionsRoute.GET(
      request("/api/history/sections?examCode=EX-SMP-XX&sub=other-user", { cookie: own }),
    );
    expect(query.status).toBe(400);
  });

  it("セクションの進捗_自分の分だけに保存され_端末の記録と統合され_他の利用者には見えない", async () => {
    const own = await cookie();
    const record = (correct: number, finishedAt: string) => ({ correct, total: 5, finishedAt });
    const put = (best: Record<string, unknown>) =>
      sectionsRoute.PUT(
        request("/api/history/sections", { method: "PUT", cookie: own, body: { examCode: "EX-SMP-XX", best } }),
      );
    expect((await put({ "0": record(3, "2026-10-01T00:00:00.000Z") })).status).toBe(200);
    // 別の端末の記録を取り込むと、セクションごとに正答数の多いほうが残る
    const merged = await put({
      "0": record(5, "2026-10-02T00:00:00.000Z"),
      "1": record(2, "2026-10-02T00:00:00.000Z"),
    });
    expect(
      ((await merged.json()) as { progress: { best: Record<string, { correct: number }> } }).progress.best,
    ).toMatchObject({
      "0": { correct: 5 },
      "1": { correct: 2 },
    });
    const mine = await sectionsRoute.GET(request("/api/history/sections?examCode=EX-SMP-XX", { cookie: own }));
    expect(((await mine.json()) as { progress: { best: object } }).progress.best).toHaveProperty("1");
    const other = await sectionsRoute.GET(
      request("/api/history/sections?examCode=EX-SMP-XX", { cookie: await adminCookie() }),
    );
    expect(await other.json()).toEqual({ progress: { examCode: "EX-SMP-XX", best: {} } });
    expect((await sectionsRoute.GET(request("/api/history/sections?examCode=EX-SMP-XX"))).status).toBe(401);
  });

  it("目標日と日ごとの学習量_自分の分だけに保存され_取得も自分の分だけ", async () => {
    const own = await cookie();
    const put = await goalRoute.PUT(
      request("/api/history/goal", { method: "PUT", cookie: own, body: { examCode: "EX-SMP-XX", date: "2026-12-20" } }),
    );
    expect(put.status).toBe(200);
    await historyRoute.POST(request("/api/history/results", { method: "POST", cookie: own, body: result() }));
    const goal = await goalRoute.GET(request("/api/history/goal?examCode=EX-SMP-XX", { cookie: own }));
    expect(await goal.json()).toEqual({ date: "2026-12-20" });
    const days = await daysRoute.GET(request("/api/history/days?examCode=EX-SMP-XX", { cookie: own }));
    expect(((await days.json()) as { days: { answered: number }[] }).days.map((d) => d.answered)).toEqual([1]);
    // ログインしていない人には、何も見えない
    expect((await goalRoute.GET(request("/api/history/goal?examCode=EX-SMP-XX"))).status).toBe(401);
    expect((await daysRoute.GET(request("/api/history/days?examCode=EX-SMP-XX"))).status).toBe(401);
  });

  it("表示の設定_自分の分だけに保存され_識別子を本文・問い合わせで渡しても拒否され_未ログインには見えない", async () => {
    const own = await cookie();
    const prefs = { theme: "dark", style: "simple", shuffleChoices: true };
    const put = (cookieHeader: string | undefined, body: unknown) =>
      prefsRoute.PUT(request("/api/history/prefs", { method: "PUT", cookie: cookieHeader, body }));
    expect((await put(undefined, prefs)).status).toBe(401);
    for (const key of ["sub", "userId", "PK", "SK"]) {
      expect((await put(own, { ...prefs, [key]: "other-user" })).status, key).toBe(400);
    }
    expect((await prefsRoute.GET(request("/api/history/prefs?sub=other-user", { cookie: own }))).status).toBe(400);
    expect((await put(own, prefs)).status).toBe(200);
    const mine = await prefsRoute.GET(request("/api/history/prefs", { cookie: own }));
    expect(await mine.json()).toEqual({ prefs });
    // 別のアカウント(管理者)には、他人の設定は見えない
    const other = await prefsRoute.GET(request("/api/history/prefs", { cookie: await adminCookie() }));
    expect(await other.json()).toEqual({ prefs: null });
    expect((await prefsRoute.GET(request("/api/history/prefs"))).status).toBe(401);
  });

  it("通知の購読で利用者の識別子を本文で渡す_拒否され_自分の区画にだけ保存される", async () => {
    const own = await cookie();
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/device-1",
      keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
    };
    const path = "/api/push/subscription";
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await pushSubscriptionRoute.PUT(
        request(path, { method: "PUT", cookie: own, body: { ...subscription, [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
    const unsubscribe = { endpoint: subscription.endpoint, sub: "other-user" };
    expect(
      (await pushSubscriptionRoute.DELETE(request(path, { method: "DELETE", cookie: own, body: unsubscribe }))).status,
    ).toBe(400);
    // テスト通知は管理者だけ。管理者でない利用者は、本文を読む前に断る
    expect(
      (
        await pushTestRoute.POST(
          request("/api/push/test", { method: "POST", cookie: own, body: { sub: "other-user" } }),
        )
      ).status,
    ).toBe(403);
    expect(await getPushRepository().listSubscriptions("other-user")).toEqual([]);

    expect(
      (await pushSubscriptionRoute.PUT(request(path, { method: "PUT", cookie: own, body: subscription }))).status,
    ).toBe(200);
    // ほかの人の区画に同じ endpoint があっても、自分の解除では消えない
    const repository = getPushRepository();
    await repository.putSubscription("other-user", { endpoint: subscription.endpoint, p256dh: "p", auth: "a" }, "t");
    const response = await pushSubscriptionRoute.DELETE(
      request(path, { method: "DELETE", cookie: own, body: { endpoint: subscription.endpoint } }),
    );
    expect(response.status).toBe(200);
    expect(await repository.listSubscriptions("other-user")).toHaveLength(1);
  });

  it("退会_自分の区画の記録と購読とアカウントだけが消え_本文で識別子を渡しても使われない", async () => {
    // 退会で消える代替の利用者の一覧を、このテストの前後で作り直す
    delete (globalThis as FakeState).__mokumokuFakeAuth;
    try {
      const own = await cookie();
      const other = await adminCookie();
      const saved = {
        examCode: "EX-SMP-XX",
        questionIds: ["SAMPLE-0001"],
        answers: { "SAMPLE-0001": ["D"] },
        finishedAt: new Date().toISOString(),
      };
      for (const c of [own, other]) {
        const posted = await historyRoute.POST(
          request("/api/history/results", { method: "POST", cookie: c, body: saved }),
        );
        expect(posted.status).toBe(200);
      }
      const target = { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", p256dh: "p", auth: "a" };
      await getPushRepository().putSubscription(fakeSub(FAKE_USER_EMAIL), target, "t");
      await getPushRepository().putSubscription(fakeSub(FAKE_ADMIN_EMAIL), target, "t");
      const remove = (body: unknown) =>
        deleteAccountRoute.POST(request("/api/auth/delete-account", { method: "POST", cookie: own, body }));

      expect((await remove({ password: FAKE_USER_PHRASE, sub: fakeSub(FAKE_ADMIN_EMAIL) })).status).toBe(400);
      const deleted = await remove({ password: FAKE_USER_PHRASE });
      expect(deleted.status).toBe(200);

      const results = async (c: string) =>
        (
          (await (
            await historyRoute.GET(request("/api/history/results?examCode=EX-SMP-XX", { cookie: c }))
          ).json()) as {
            results: unknown[];
          }
        ).results;
      expect(await results(other)).toHaveLength(1);
      expect(await getPushRepository().listSubscriptions(fakeSub(FAKE_USER_EMAIL))).toEqual([]);
      expect(await getPushRepository().listSubscriptions(fakeSub(FAKE_ADMIN_EMAIL))).toHaveLength(1);
      await expect(getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE)).rejects.toMatchObject({
        code: "invalid-credentials",
      });
      // 同じ利用者の区画を、別の手段で読み直しても空
      expect((await getHistoryRepository().listResults(fakeSub(FAKE_USER_EMAIL), "EX-SMP-XX")).results).toEqual([]);
    } finally {
      // 管理者の分として保存した記録も、後のテストに残さない
      delete (globalThis as FakeState).__mokumokuFakeAuth;
      delete (globalThis as { __mokumokuFakeHistory?: unknown }).__mokumokuFakeHistory;
      delete (globalThis as { __mokumokuFakePush?: unknown }).__mokumokuFakePush;
    }
  });
});

type FakeState = { __mokumokuFakeAuth?: unknown; __mokumokuFakeAudit?: { entries: AuditEntry[] } };

describe("認可: 管理者だけが開ける", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
    // 登録・無効化で変わる代替の利用者の一覧と、操作の記録を、テストごとに作り直す
    delete (globalThis as FakeState).__mokumokuFakeAuth;
    delete (globalThis as FakeState).__mokumokuFakeAudit;
    delete (globalThis as { __mokumokuFakePush?: unknown }).__mokumokuFakePush;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(headers).mockReset();
  });

  async function cookieOf(email: string, phrase: string): Promise<string> {
    const signedIn = await getAuthProvider().signIn(email, phrase);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    return withTokenCookies(null, signedIn.tokens);
  }
  const learner = () => cookieOf(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
  const admin = () => cookieOf(FAKE_ADMIN_EMAIL, FAKE_ADMIN_PHRASE);
  const passed = (response: Response) => response.status === 200 && response.headers.get("x-middleware-next") === "1";

  it("管理者_入口(proxy)を通る", async () => {
    const cookie = await admin();
    for (const path of [...ADMIN_PAGES, "/admin/users", "/admin/preview/AIB"]) {
      expect(passed(await proxy(request(path, { cookie }))), path).toBe(true);
    }
  });

  it("管理者でない利用者_管理者の画面はホームへ移し_管理者の API は 403 で断る", async () => {
    const cookie = await learner();
    for (const path of [...ADMIN_PAGES, "/admin/users", "/admin/preview/AIB"]) {
      const response = await proxy(request(path, { cookie }));
      expect(response.status, path).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
    }
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      const response = await proxy(request("/api/admin/users", { cookie, method }));
      expect(response.status, method).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
  });

  it("管理者でない利用者_経路の書き方を変えても通らない", async () => {
    const cookie = await learner();
    for (const path of ["/Admin", "/%61dmin", "//admin", "/admin%2Fusers", "/api//admin/users", "/API/admin/users"]) {
      expect(passed(await proxy(request(path, { cookie }))), path).toBe(false);
    }
  });

  it("管理者でない利用者が_管理者だと申告する_問い合わせ・ヘッダー・Cookie のどれも使われない", async () => {
    const own = await learner();
    const claims = [
      request("/admin?admin=1&groups=admins&cognito:groups=admins", { cookie: own }),
      new NextRequest("http://localhost/admin", {
        headers: { cookie: own, "x-admin": "1", "x-user-groups": "admins", "x-amzn-oidc-groups": "admins" },
      }),
      request("/admin", { cookie: `${own}; cognito:groups=admins; groups=admins; isAdmin=true` }),
    ];
    for (const claim of claims) expect(passed(await proxy(claim))).toBe(false);
  });

  it("管理者の画面の本体(レイアウト)_入口を通らなくても_管理者でなければホームへ移す(二重の防御)", async () => {
    const render = async (cookie: string | null) => {
      vi.mocked(headers).mockResolvedValue(new Headers(cookie ? { cookie } : {}) as never);
      return AdminLayout({ children: "管理者の画面" });
    };
    await expect(render(null)).rejects.toThrow("NEXT_REDIRECT");
    await expect(render("mokumoku_id=forged")).rejects.toThrow("NEXT_REDIRECT");
    await expect(render(await learner())).rejects.toThrow("NEXT_REDIRECT");
    expect(await render(await admin())).toBe("管理者の画面");
  });

  it("管理者の画面の本体(レイアウト)_認証の設定がない_管理者として扱わない(通す側には倒さない)", async () => {
    const cookie = await admin();
    vi.stubEnv("AUTH_FAKE", "");
    vi.stubEnv("COGNITO_CLIENT_ID", "");
    vi.stubEnv("COGNITO_USER_POOL_ID", "");
    vi.mocked(headers).mockResolvedValue(new Headers({ cookie }) as never);
    await expect(AdminLayout({ children: "管理者の画面" })).rejects.toThrow("NEXT_REDIRECT");
  });
  const auditEntries = () => (globalThis as FakeState).__mokumokuFakeAudit?.entries ?? [];
  const listedUsers = () => getUserAdmin().listUsers();
  const disable = (cookie: string | undefined, body: unknown) =>
    adminDisableRoute.POST(request("/api/admin/users/disable", { method: "POST", cookie, body }));

  it("管理者の API の本体_入口を通らなくても_未ログイン・管理者でない利用者を断り_何も変えない(二重の防御)", async () => {
    const target = fakeSub(FAKE_INVITED_EMAIL);
    for (const cookie of [undefined, "mokumoku_id=forged; mokumoku_access=forged", await learner()]) {
      const label = cookie ? cookie.slice(0, 12) : "none";
      expect((await adminUsersRoute.GET(request("/api/admin/users", { cookie }))).status, label).toBe(403);
      expect((await disable(cookie, { username: target })).status, label).toBe(403);
    }
    const users = await listedUsers();
    expect(users.find((u) => u.username === target)?.enabled).toBe(true);
    expect(auditEntries()).toEqual([]);
  });

  it("管理者の API_管理者は一覧・無効化ができ_操作の記録に検証した管理者の sub が残る", async () => {
    const cookie = await admin();
    const listed = await adminUsersRoute.GET(request("/api/admin/users", { cookie }));
    expect(listed.status).toBe(200);
    const { users } = (await listed.json()) as { users: { email: string; self: boolean }[] };
    expect(users.find((u) => u.email === FAKE_ADMIN_EMAIL)?.self).toBe(true);

    // 招待済みで未使用の利用者は、一覧に初回ログイン前の状態で出る
    expect(users.find((u) => u.email === FAKE_INVITED_EMAIL)).toBeTruthy();
    expect((await listedUsers()).find((u) => u.email === FAKE_INVITED_EMAIL)?.status).toBe("FORCE_CHANGE_PASSWORD");

    const target = fakeSub(FAKE_USER_EMAIL);
    expect((await disable(cookie, { username: target })).status).toBe(200);
    await expect(getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE)).rejects.toMatchObject({
      code: "invalid-credentials",
    });
    expect(auditEntries()).toEqual([
      { at: expect.any(String), actor: fakeSub(FAKE_ADMIN_EMAIL), target, action: "disable-user" },
    ]);
  });

  it("管理者の API_利用者の識別子をリクエストから受け取らない_自分自身は無効にできない", async () => {
    const cookie = await admin();
    for (const key of ["sub", "userId", "actor", "PK"]) {
      const response = await adminUsersRoute.GET(request(`/api/admin/users?${key}=other-user`, { cookie }));
      expect(response.status, key).toBe(400);
      expect((await disable(cookie, { username: fakeSub(FAKE_USER_EMAIL), [key]: "other-user" })).status, key).toBe(
        400,
      );
    }
    // ヘッダーで別の管理者を名乗っても、記録には検証した管理者の sub が入る
    const withHeaders = new NextRequest("http://localhost/api/admin/users/disable", {
      method: "POST",
      headers: { cookie, "content-type": "application/json", "x-user-id": "other-user", "x-amzn-oidc-subject": "x" },
      body: JSON.stringify({ username: fakeSub(FAKE_USER_EMAIL) }),
    });
    expect((await adminDisableRoute.POST(withHeaders)).status).toBe(200);
    expect(auditEntries().map((e) => e.actor)).toEqual([fakeSub(FAKE_ADMIN_EMAIL)]);

    const self = await disable(cookie, { username: fakeSub(FAKE_ADMIN_EMAIL) });
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: "self-disable" });
    expect((await listedUsers()).find((u) => u.email === FAKE_ADMIN_EMAIL)?.enabled).toBe(true);
    expect(auditEntries()).toHaveLength(1);
  });

  it("テスト通知の API の本体_管理者は自分にだけ送れ_管理者でない利用者・未ログインは断られる", async () => {
    // 送り先が自分の購読だけ(購読がなければ 0 件)であることを、外へ送らずに確かめる
    vi.stubEnv("VAPID_PUBLIC_KEY", "public-key-example");
    // 秘密鍵はパラメーターの名前だけ。購読がなければ、パラメーターを読まずに 0 件で終わる
    vi.stubEnv("VAPID_PRIVATE_KEY_PARAMETER", "/example/push/vapid-private-key");
    vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
    const sendTest = (cookie?: string, body: unknown = {}) =>
      pushTestRoute.POST(request("/api/push/test", { method: "POST", cookie, body }));
    const repository = getPushRepository();
    const target = { endpoint: "https://fcm.googleapis.com/fcm/send/device-1", p256dh: "p", auth: "a" };
    await repository.putSubscription(fakeSub(FAKE_USER_EMAIL), target, "t");

    const own = await learner();
    const forbidden = await sendTest(own);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    expect((await sendTest()).status).toBe(401);
    expect((await sendTest("mokumoku_id=forged; mokumoku_access=forged")).status).toBe(401);
    // 管理者でない利用者が、管理者だと申告しても通らない
    expect((await sendTest(`${own}; cognito:groups=admins; isAdmin=true`, {})).status).toBe(403);

    const cookie = await admin();
    const sent = await sendTest(cookie);
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({ sent: 0 });
    // 送り先を本文で指定することはできない
    expect((await sendTest(cookie, { sub: fakeSub(FAKE_USER_EMAIL) })).status).toBe(400);
    expect(await repository.listSubscriptions(fakeSub(FAKE_USER_EMAIL))).toHaveLength(1);
  });

  it("1 回分の結果・問題ごとの集計・復習の項目_自分の分だけを読め_他人の分は読めず外せない", async () => {
    const learnerCookie = await learner();
    const adminCookie = await admin();
    const finishedAt = new Date().toISOString();
    const saved = {
      examCode: "EX-SMP-XX",
      questionIds: ["SAMPLE-0001"],
      answers: { "SAMPLE-0001": ["D"] },
      finishedAt,
    };
    // 学習者が不正解の結果を保存する(復習に入り、解答回数が数えられる)
    const posted = await historyRoute.POST(
      request("/api/history/results", { method: "POST", cookie: learnerCookie, body: saved }),
    );
    expect(posted.status).toBe(200);
    const one = (cookie: string) =>
      resultRoute.GET(
        request(`/api/history/result?examCode=EX-SMP-XX&finishedAt=${encodeURIComponent(finishedAt)}`, { cookie }),
      );
    expect(await (await one(learnerCookie)).json()).toEqual({ result: saved });
    // 別の利用者は、同じ資格・同じ完了時刻を指定しても読めない
    const other = await one(adminCookie);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: "not-found" });

    const stats = async (cookie: string) =>
      (
        (await (await statsRoute.GET(request("/api/history/stats?examCode=EX-SMP-XX", { cookie }))).json()) as {
          stats: { questionId: string; count: number }[];
        }
      ).stats;
    expect((await stats(learnerCookie)).map((s) => [s.questionId, s.count])).toEqual([["SAMPLE-0001", 1]]);
    expect(await stats(adminCookie)).toEqual([]);

    const items = async (cookie: string) =>
      (
        (await (await reviewAllRoute.GET(request("/api/history/review/all", { cookie }))).json()) as {
          items: { questionId: string }[];
        }
      ).items.map((i) => i.questionId);
    expect(await items(learnerCookie)).toEqual(["SAMPLE-0001"]);
    expect(await items(adminCookie)).toEqual([]);

    // 別の利用者が外そうとしても、自分の区画の項目(ない)を消すだけで、学習者の復習は残る
    const removal = { examCode: "EX-SMP-XX", questionId: "SAMPLE-0001" };
    const removedByOther = await reviewRoute.DELETE(
      request("/api/history/review", { method: "DELETE", cookie: adminCookie, body: removal }),
    );
    expect(removedByOther.status).toBe(200);
    expect(await items(learnerCookie)).toEqual(["SAMPLE-0001"]);
    // 利用者の識別子を本文や問い合わせで渡しても、使われず断られる
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const withKey = await reviewRoute.DELETE(
        request("/api/history/review", {
          method: "DELETE",
          cookie: adminCookie,
          body: { ...removal, [key]: fakeSub(FAKE_USER_EMAIL) },
        }),
      );
      expect(withKey.status, key).toBe(400);
    }
    for (const path of [
      "/api/history/review/all?sub=other-user",
      "/api/history/stats?examCode=EX-SMP-XX&sub=other-user",
      `/api/history/result?examCode=EX-SMP-XX&finishedAt=${encodeURIComponent(finishedAt)}&sub=other-user`,
    ]) {
      const route = path.startsWith("/api/history/review")
        ? reviewAllRoute
        : path.startsWith("/api/history/stats")
          ? statsRoute
          : resultRoute;
      expect((await route.GET(request(path, { cookie: adminCookie }))).status, path).toBe(400);
    }
    expect(await items(learnerCookie)).toEqual(["SAMPLE-0001"]);

    // 本人は外せる
    const removed = await reviewRoute.DELETE(
      request("/api/history/review", { method: "DELETE", cookie: learnerCookie, body: removal }),
    );
    expect(removed.status).toBe(200);
    expect(await items(learnerCookie)).toEqual([]);
  });
});
