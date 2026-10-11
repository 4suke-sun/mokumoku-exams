import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { headers } from "next/headers";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminLayout from "@/app/admin/layout.tsx";
import * as changePasswordRoute from "@/app/api/auth/change-password/route.ts";
import * as bookmarksRoute from "@/app/api/history/bookmarks/route.ts";
import * as daysRoute from "@/app/api/history/days/route.ts";
import * as goalRoute from "@/app/api/history/goal/route.ts";
import * as historyRoute from "@/app/api/history/results/route.ts";
import * as reviewRoute from "@/app/api/history/review/route.ts";
import { isAdminPath } from "@/lib/auth/admin.ts";
import { FAKE_ADMIN_EMAIL, FAKE_ADMIN_PHRASE, FAKE_USER_EMAIL, FAKE_USER_PHRASE } from "@/lib/auth/fake.ts";
import { isPublicPath, PUBLIC_AUTH_API_PATHS } from "@/lib/auth/guard.ts";
import { getAuthProvider } from "@/lib/auth/index.ts";
import { withTokenCookies } from "@/lib/auth/session.ts";
import { SUB_PATTERN } from "@/lib/auth/verify.ts";
import { proxy } from "./proxy.ts";

// 認可の網羅テスト。「ログインなしで開けるもの」と「ログインが要るもの」を、一覧として固定する。
// 新しい画面や API を足したときは、この一覧に足すまでテストが落ちる(保護するかどうかを、意識して決めるため)。
// 一覧に載せない限り、新しい経路は保護される(proxy は許可リスト方式)。

// 管理者の画面のレイアウトが読む、リクエストのヘッダー(テストごとに Cookie を差し替える)
vi.mock("next/headers", () => ({ headers: vi.fn() }));

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "app");

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

const PUBLIC_PAGES = ["/forgot-password", "/login"];
const PROTECTED_PAGES = [
  "/",
  "/account",
  "/admin",
  "/bookmarks",
  "/exams",
  "/exams/sample",
  "/exams/sample/dashboard",
  "/exams/sample/play",
  "/exams/sample/result",
  "/exams/sample/study",
  "/exams/sample/study/sample",
  "/help",
];
/** 保護される画面のうち、管理者だけが開けるもの */
const ADMIN_PAGES = ["/admin"];
const PUBLIC_APIS = [
  "/api/auth/forgot-password",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/new-password",
  "/api/auth/refresh",
  "/api/auth/reset-password",
  "/api/auth/session",
];
const PROTECTED_APIS = [
  "/api/auth/change-password",
  "/api/history/bookmarks",
  "/api/history/days",
  "/api/history/goal",
  "/api/history/results",
  "/api/history/review",
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
  });

  it("管理者の経路_一覧に挙げた画面だけで_ほかの画面と API は含まない", () => {
    const allPaths = [...routesOf("page.tsx"), ...routesOf("route.ts")];
    expect(allPaths.filter((path) => isAdminPath(path)).sort()).toEqual(ADMIN_PAGES);
    for (const path of ADMIN_PAGES) expect(PROTECTED_PAGES).toContain(path);
  });

  it("保護される API_公開の一覧に似た経路でも_公開にならない", () => {
    for (const path of ["/api/auth", "/api/auth/", "/api/auth/change-password", "/api/auth/login/x", "/api/history"]) {
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

  it("偽のトークン_API も画面も開けない", async () => {
    const forged = "mokumoku_id=forged; mokumoku_access=forged";
    for (const path of PROTECTED_APIS) expect((await proxy(request(path, { cookie: forged }))).status).toBe(401);
    for (const path of PROTECTED_PAGES) expect((await proxy(request(path, { cookie: forged }))).status).toBe(307);
  });

  it("履歴の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await historyRoute.GET(request("/api/history/results?examCode=SAMPLE"))).status).toBe(401);
    const response = await historyRoute.POST(
      request("/api/history/results", {
        method: "POST",
        body: {
          examCode: "SAMPLE",
          questionIds: ["SAMPLE-0001"],
          answers: {},
          finishedAt: new Date().toISOString(),
        },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("ブックマークと復習プールの API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await bookmarksRoute.GET(request("/api/history/bookmarks?examCode=SAMPLE"))).status).toBe(401);
    expect((await reviewRoute.GET(request("/api/history/review?examCode=SAMPLE"))).status).toBe(401);
    const response = await bookmarksRoute.PUT(
      request("/api/history/bookmarks", {
        method: "PUT",
        body: { examCode: "SAMPLE", questionId: "SAMPLE-0001", bookmarked: true },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("日ごとの学習量と目標日の API 本体_入口を通らなくても未ログインを断る(二重の防御)", async () => {
    expect((await daysRoute.GET(request("/api/history/days?examCode=SAMPLE"))).status).toBe(401);
    expect((await goalRoute.GET(request("/api/history/goal?examCode=SAMPLE"))).status).toBe(401);
    const response = await goalRoute.PUT(
      request("/api/history/goal", { method: "PUT", body: { examCode: "SAMPLE", date: "2026-12-20" } }),
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

  it("保護される API_受け付けるメソッドは宣言した分だけ(足したときは認可のテストも足す)", () => {
    const methods = (module: object) => Object.keys(module).filter((k) => /^[A-Z]+$/.test(k));
    expect(methods(historyRoute).sort()).toEqual(["GET", "POST"]);
    expect(methods(bookmarksRoute).sort()).toEqual(["GET", "PUT"]);
    expect(methods(reviewRoute)).toEqual(["GET"]);
    expect(methods(daysRoute)).toEqual(["GET"]);
    expect(methods(goalRoute).sort()).toEqual(["GET", "PUT"]);
    expect(methods(changePasswordRoute)).toEqual(["POST"]);
  });
});

describe("認可: 他人のデータに触れない", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
    delete (globalThis as { __mokumokuFakeHistory?: unknown }).__mokumokuFakeHistory;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function cookie(): Promise<string> {
    const signedIn = await getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    return withTokenCookies(null, signedIn.tokens);
  }

  const result = () => ({
    examCode: "SAMPLE",
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
        request(`/api/history/results?examCode=SAMPLE&${key}=other-user`, { cookie: own }),
      );
      expect(response.status, key).toBe(400);
    }
    const withHeaders = new NextRequest("http://localhost/api/history/results?examCode=SAMPLE", {
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

  it("ブックマークで利用者の識別子を本文・問い合わせで渡す_拒否される", async () => {
    const own = await cookie();
    const change = { examCode: "SAMPLE", questionId: "SAMPLE-0001", bookmarked: true };
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await bookmarksRoute.PUT(
        request("/api/history/bookmarks", { method: "PUT", cookie: own, body: { ...change, [key]: "other-user" } }),
      );
      expect(response.status, key).toBe(400);
    }
    for (const route of [bookmarksRoute, reviewRoute]) {
      const response = await route.GET(
        request("/api/history/bookmarks?examCode=SAMPLE&sub=other-user", { cookie: own }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("目標日と日ごとの学習量で利用者の識別子を本文・問い合わせで渡す_拒否される", async () => {
    const own = await cookie();
    const change = { examCode: "SAMPLE", date: "2026-12-20" };
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
      const response = await route.GET(request(`${path}?examCode=SAMPLE&sub=other-user`, { cookie: own }));
      expect(response.status, path).toBe(400);
    }
  });

  it("資格コードにキーの区切りを入れて他の区画を読もうとする_断られる", async () => {
    const own = await cookie();
    for (const examCode of ["SAMPLE%23", "SAMPLE%23USER%23other", "%23", "USER%23other", "SAMPLE%2523", "sample"]) {
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
    const mine = await historyRoute.GET(request("/api/history/results?examCode=SAMPLE", { cookie: own }));
    expect(((await mine.json()) as { results: unknown[] }).results).toEqual([saved]);
    // ログインしていない人には、何も見えない
    expect((await historyRoute.GET(request("/api/history/results?examCode=SAMPLE"))).status).toBe(401);
  });

  it("ブックマークと復習プール_自分の分だけに保存され_取得も自分の分だけ", async () => {
    const own = await cookie();
    const put = await bookmarksRoute.PUT(
      request("/api/history/bookmarks", {
        method: "PUT",
        cookie: own,
        body: { examCode: "SAMPLE", questionId: "SAMPLE-0002", bookmarked: true },
      }),
    );
    expect(put.status).toBe(200);
    // 不正解の結果を保存すると、その問題が復習プールに入る
    await historyRoute.POST(request("/api/history/results", { method: "POST", cookie: own, body: result() }));
    const bookmarks = await bookmarksRoute.GET(request("/api/history/bookmarks?examCode=SAMPLE", { cookie: own }));
    expect(await bookmarks.json()).toEqual({ questionIds: ["SAMPLE-0002"] });
    const review = await reviewRoute.GET(request("/api/history/review?examCode=SAMPLE", { cookie: own }));
    expect(await review.json()).toEqual({ questionIds: ["SAMPLE-0001"] });
  });

  it("目標日と日ごとの学習量_自分の分だけに保存され_取得も自分の分だけ", async () => {
    const own = await cookie();
    const put = await goalRoute.PUT(
      request("/api/history/goal", { method: "PUT", cookie: own, body: { examCode: "SAMPLE", date: "2026-12-20" } }),
    );
    expect(put.status).toBe(200);
    await historyRoute.POST(request("/api/history/results", { method: "POST", cookie: own, body: result() }));
    const goal = await goalRoute.GET(request("/api/history/goal?examCode=SAMPLE", { cookie: own }));
    expect(await goal.json()).toEqual({ date: "2026-12-20" });
    const days = await daysRoute.GET(request("/api/history/days?examCode=SAMPLE", { cookie: own }));
    expect(((await days.json()) as { days: { answered: number }[] }).days.map((d) => d.answered)).toEqual([1]);
    // ログインしていない人には、何も見えない
    expect((await goalRoute.GET(request("/api/history/goal?examCode=SAMPLE"))).status).toBe(401);
    expect((await daysRoute.GET(request("/api/history/days?examCode=SAMPLE"))).status).toBe(401);
  });
});

describe("認可: 管理者だけが開ける", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
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
    for (const path of [...ADMIN_PAGES, "/admin/users"]) {
      expect(passed(await proxy(request(path, { cookie }))), path).toBe(true);
    }
  });

  it("管理者でない利用者_管理者の画面はホームへ移し_管理者の API は 403 で断る", async () => {
    const cookie = await learner();
    for (const path of [...ADMIN_PAGES, "/admin/users"]) {
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
});
