import { describe, expect, it, vi } from "vitest";
import { createFakeProvider, createFakeVerifier, FAKE_USER_EMAIL, FAKE_USER_PHRASE } from "@/lib/auth/fake.ts";
import { withTokenCookies } from "@/lib/auth/session.ts";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { PREFS_COOKIE, parsePrefsCookie } from "@/lib/prefs-cookie.ts";
import { MAX_ANSWER_TIME_MS, type Result } from "@/lib/storage.ts";
import {
  type HistoryDeps,
  handleDeleteReview,
  handleGetGoal,
  handleGetNotebook,
  handleGetPrefs,
  handleGetResult,
  handleListBookmarks,
  handleListDays,
  handleListResults,
  handleListReviewItems,
  handleListStats,
  handlePostResult,
  handlePutBookmark,
  handlePutGoal,
  handlePutNotebook,
  handlePutPrefs,
  reviewChangeOf,
  tallyOf,
} from "./handlers.ts";
import {
  createDynamoRepository,
  createMemoryRepository,
  type HistoryRepository,
  RESULTS_PAGE_SIZE,
} from "./repository.ts";
import { fakeTable } from "./table-double.ts";

const ORIGIN = "http://localhost";
/** 完了時刻の範囲の検査を、時計に頼らず確かめるための「いま」 */
const NOW = Date.parse("2026-10-12T00:00:00.000Z");

/** トークンの文字列から利用者を決める検証(署名の検証そのものは verify.test.ts で確かめる) */
const verifier: TokenVerifier = {
  async verifyIdToken(token) {
    return token.startsWith("token-") ? { sub: token.slice("token-".length), groups: [] } : null;
  },
};
const noRefresh = {
  async refresh() {
    throw new Error("unavailable");
  },
} as unknown as AuthProvider;

function deps(repository: HistoryRepository = createMemoryRepository()): HistoryDeps {
  return { auth: { verifier, provider: noRefresh, secure: false }, repository, now: () => NOW };
}

const asUser = (sub: string) => `mokumoku_id=token-${sub}`;
const body = (result: Record<string, unknown> = {}) => ({
  examCode: "EX-SMP-XX",
  questionIds: ["SAMPLE-0001"],
  answers: { "SAMPLE-0001": ["A"] },
  finishedAt: "2026-10-11T12:00:00.000Z",
  ...result,
});

function post(value: unknown, headers: Record<string, string> = {}, raw?: string) {
  return new Request(`${ORIGIN}/api/history/results`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ?? JSON.stringify(value),
  });
}

const get = (query: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/history/results?${query}`, { headers });

describe("履歴 API の認証", () => {
  it("未ログイン_取得も保存も 401 で断る", async () => {
    const d = deps();
    expect((await handleListResults(get("examCode=EX-SMP-XX"), d)).status).toBe(401);
    expect((await handlePostResult(post(body()), d)).status).toBe(401);
  });

  it("検証に通らないトークン_401 で断り_何も保存しない", async () => {
    const repository = createMemoryRepository();
    const d = deps(repository);
    const response = await handlePostResult(post(body(), { cookie: "mokumoku_id=forged" }), d);
    expect(response.status).toBe(401);
    expect((await repository.listResults("forged", "EX-SMP-XX")).results).toEqual([]);
  });

  it("検証の処理が失敗した_401 で断る(通す側には倒さない)", async () => {
    const d: HistoryDeps = {
      auth: {
        verifier: {
          async verifyIdToken() {
            throw new Error("boom");
          },
        },
        provider: noRefresh,
        secure: false,
      },
      repository: createMemoryRepository(),
    };
    expect((await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("a") }), d)).status).toBe(401);
  });

  it("ID トークンが消えていてリフレッシュトークンが有効_更新した Cookie を付けて通す", async () => {
    const now = () => Date.now();
    const provider = createFakeProvider(now);
    const signedIn = await provider.signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    const cookie = `mokumoku_refresh=${encodeURIComponent(signedIn.tokens.refreshToken ?? "")}`;
    const d: HistoryDeps = {
      auth: { verifier: createFakeVerifier(now), provider, secure: false },
      repository: createMemoryRepository(),
    };
    const response = await handleListResults(get("examCode=EX-SMP-XX", { cookie }), d);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("mokumoku_id=");
    expect(withTokenCookies(null, signedIn.tokens)).toContain("mokumoku_id=");
  });
});

describe("履歴の保存と取得", () => {
  it("保存した結果_同じ利用者が取得できる", async () => {
    const d = deps();
    const saved = await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    expect(saved.status).toBe(200);
    const listed = await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("a") }), d);
    expect(((await listed.json()) as { results: Result[] }).results).toHaveLength(1);
  });

  it("別の利用者_他人の結果は取得できない", async () => {
    const d = deps();
    await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    const listed = await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("b") }), d);
    expect(((await listed.json()) as { results: Result[] }).results).toEqual([]);
  });

  it("本文に別の利用者の識別子を入れた_断り_自分にも相手にも保存しない", async () => {
    const repository = createMemoryRepository();
    const d = deps(repository);
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await handlePostResult(post(body({ [key]: "user-a" }), { cookie: asUser("b") }), d);
      expect(response.status).toBe(400);
    }
    expect((await repository.listResults("a", "EX-SMP-XX")).results).toEqual([]);
    expect((await repository.listResults("b", "EX-SMP-XX")).results).toEqual([]);
    expect((await repository.listResults("user-a", "EX-SMP-XX")).results).toEqual([]);
  });

  it("問い合わせに別の利用者の識別子を入れた_断る", async () => {
    const d = deps();
    const response = await handleListResults(get("examCode=EX-SMP-XX&sub=a", { cookie: asUser("b") }), d);
    expect(response.status).toBe(400);
  });

  it("同じ結果を繰り返し送る_重複しない", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    const listed = await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("a") }), d);
    expect(((await listed.json()) as { results: Result[] }).results).toHaveLength(1);
  });

  it("件数の上限なしで残し_一覧はページで返し_next で続きを取れる", async () => {
    const d = deps();
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString();
    for (let minute = 0; minute <= RESULTS_PAGE_SIZE; minute++) {
      await handlePostResult(post(body({ finishedAt: at(minute) }), { cookie: asUser("a") }), d);
    }
    const listed = await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("a") }), d);
    const page = (await listed.json()) as { results: Result[]; next: string | null };
    expect(page.results).toHaveLength(RESULTS_PAGE_SIZE);
    expect(page.results[0]?.finishedAt).toBe(at(RESULTS_PAGE_SIZE));
    expect(page.next).toBe(at(1));
    const rest = await handleListResults(
      get(`examCode=EX-SMP-XX&before=${encodeURIComponent(page.next ?? "")}`, { cookie: asUser("a") }),
      d,
    );
    expect(await rest.json()).toEqual({ results: [body({ finishedAt: at(0) })], next: null });
  });

  it("続きの問い合わせの時刻が正しくない_400 で断る", async () => {
    for (const before of ["yesterday", "2026-10-11", "2026-10-11T12:00:00Z"]) {
      const response = await handleListResults(
        get(`examCode=EX-SMP-XX&before=${before}`, { cookie: asUser("a") }),
        deps(),
      );
      expect(response.status, before).toBe(400);
    }
  });
});

describe("履歴 API の入力", () => {
  const cookie = asUser("a");

  it.each([
    ["資格コードに区切り文字がある", { examCode: "A#B" }],
    ["資格コードが小文字", { examCode: "sample" }],
    ["完了時刻が日時の形でない", { finishedAt: "not-a-date" }],
    ["完了時刻にミリ秒がない(並びが時刻の順にならない)", { finishedAt: "2026-10-11T12:00:00Z" }],
    ["完了時刻にタイムゾーンの差がある", { finishedAt: "2026-10-11T12:00:00.000+09:00" }],
    ["問題がない", { questionIds: [] }],
    ["未知の項目がある", { extra: 1 }],
  ])("%s_400 で断る", async (_name, overrides) => {
    const response = await handlePostResult(post(body(overrides), { cookie }), deps());
    expect(response.status).toBe(400);
  });

  it("本文が JSON でない_400 で断る", async () => {
    expect((await handlePostResult(post(undefined, { cookie }, "{not json"), deps())).status).toBe(400);
  });

  it("本文が大きすぎる_413 で断り_保存しない", async () => {
    const repository = createMemoryRepository();
    const big = body({
      answers: { "SAMPLE-0001": ["A"] },
      questionIds: Array.from({ length: 500 }, () => "Q".repeat(64)),
    });
    const response = await handlePostResult(
      post(big, { cookie }, JSON.stringify(big).padEnd(200_000, " ")),
      deps(repository),
    );
    expect(response.status).toBe(413);
    expect((await repository.listResults("a", "EX-SMP-XX")).results).toEqual([]);
  });

  it("JSON でない形式で送る_415 で断る", async () => {
    const request = new Request(`${ORIGIN}/api/history/results`, {
      method: "POST",
      headers: { "content-type": "text/plain", cookie },
      body: JSON.stringify(body()),
    });
    expect((await handlePostResult(request, deps())).status).toBe(415);
  });

  it("別のサイトからの送信_403 で断る", async () => {
    const response = await handlePostResult(post(body(), { cookie, "sec-fetch-site": "cross-site" }), deps());
    expect(response.status).toBe(403);
  });

  it("資格コードのない問い合わせ_400 で断る", async () => {
    expect((await handleListResults(get("", { cookie }), deps())).status).toBe(400);
  });

  it("同じ名前の問い合わせが重なる_どちらを使うか曖昧なので 400 で断る", async () => {
    expect((await handleListResults(get("examCode=EX-SMP-XX&examCode=EX-OTH-XX", { cookie }), deps())).status).toBe(
      400,
    );
  });
});

describe("履歴 API の入力の検証", () => {
  const cookie = asUser("a");
  const hour = 60 * 60 * 1000;

  it.each([
    ["問題 ID が決まった形でない", { questionIds: ["q1"], answers: {} }],
    ["問題 ID が重なる", { questionIds: ["SAMPLE-0001", "SAMPLE-0001"], answers: {} }],
    ["出題にない問題への回答がある", { answers: { "SAMPLE-0009": ["A"] } }],
    ["選択肢のキーが A から J の外", { answers: { "SAMPLE-0001": ["K"] } }],
    ["選択肢のキーが小文字", { answers: { "SAMPLE-0001": ["a"] } }],
    ["選択肢のキーが重なる", { answers: { "SAMPLE-0001": ["A", "A"] } }],
    ["選択肢のキーが 11 個以上", { answers: { "SAMPLE-0001": Array.from({ length: 11 }, () => "A") } }],
    ["出題にない問題の選択肢の並びがある", { choiceOrder: { "SAMPLE-0009": ["A", "B"] } }],
    ["選択肢の並びにキーの重なりがある", { choiceOrder: { "SAMPLE-0001": ["A", "A"] } }],
    ["回答が配列でない", { answers: { "SAMPLE-0001": "A" } }],
    ["出題にない問題への自由記述の回答がある", { textAnswers: { "SAMPLE-0009": "回答" } }],
    ["自由記述の回答が長すぎる", { textAnswers: { "SAMPLE-0001": "あ".repeat(1001) } }],
    ["自由記述の回答が文字列でない", { textAnswers: { "SAMPLE-0001": ["A"] } }],
    ["回答が配列の外", { answers: [] }],
    ["完了時刻が文字列でない", { finishedAt: 20261011 }],
    ["資格コードが文字列でない", { examCode: 1 }],
    ["回答時間の数が問題の数と合わない", { timesMs: [1000, 2000] }],
    ["回答時間が上限を超える", { timesMs: [MAX_ANSWER_TIME_MS + 1] }],
    ["回答時間が負", { timesMs: [-1] }],
    ["回答時間が整数でない", { timesMs: [1.5] }],
    ["自信なしの数が問題の数と合わない", { unsure: [] }],
    ["自信なしが真偽値でない", { unsure: ["yes"] }],
    ["見直しの数が問題の数と合わない", { flagged: [true, false] }],
  ])("%s_400 で断り_何も保存しない", async (_name, overrides) => {
    const repository = createMemoryRepository();
    const response = await handlePostResult(post(body(overrides), { cookie }), deps(repository));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "bad-request" });
    expect((await repository.listResults("a", "EX-SMP-XX")).results).toEqual([]);
  });

  it("完了時刻が時計のずれの幅を超えて先_400 で断る", async () => {
    const tooLate = new Date(NOW + 25 * hour).toISOString();
    expect((await handlePostResult(post(body({ finishedAt: tooLate }), { cookie }), deps())).status).toBe(400);
  });

  it("完了時刻が時計のずれの幅の中_受け付ける", async () => {
    const soon = new Date(NOW + 23 * hour).toISOString();
    expect((await handlePostResult(post(body({ finishedAt: soon }), { cookie }), deps())).status).toBe(200);
  });

  it("完了時刻が下限より前_400 で断る", async () => {
    const old = "2019-12-31T23:59:59.999Z";
    expect((await handlePostResult(post(body({ finishedAt: old }), { cookie }), deps())).status).toBe(400);
  });

  it("完了時刻がちょうど下限_受け付ける", async () => {
    const earliest = "2020-01-01T00:00:00.000Z";
    expect((await handlePostResult(post(body({ finishedAt: earliest }), { cookie }), deps())).status).toBe(200);
  });

  it("時計を渡さない_実際の現在の時刻で範囲を確かめる", async () => {
    const d: HistoryDeps = { auth: deps().auth, repository: createMemoryRepository() };
    const justNow = new Date().toISOString();
    expect((await handlePostResult(post(body({ finishedAt: justNow }), { cookie }), d)).status).toBe(200);
  });

  it("選択肢の並びと回答が正しい形_受け付ける", async () => {
    const valid = body({
      questionIds: ["SAMPLE-0001", "SAMPLE-0002"],
      answers: { "SAMPLE-0001": ["A", "C"] },
      choiceOrder: { "SAMPLE-0001": ["C", "B", "A"], "SAMPLE-0002": ["D", "A"] },
    });
    expect((await handlePostResult(post(valid, { cookie }), deps())).status).toBe(200);
  });

  it("自由記述の回答_上限の長さまで受け付け_取得で同じ内容が返る", async () => {
    const repository = createMemoryRepository();
    const withText = body({
      questionIds: ["SAMPLE-0001", "SAMPLE-0006"],
      textAnswers: { "SAMPLE-0006": "あ".repeat(1000) },
    });
    expect((await handlePostResult(post(withText, { cookie }), deps(repository))).status).toBe(200);
    expect((await repository.listResults("a", "EX-SMP-XX")).results).toEqual([withText]);
  });

  it("回答時間・自信なし・見直し_問題の数と同じ長さなら受け付け_取得で同じ内容が返る", async () => {
    const repository = createMemoryRepository();
    const marked = body({
      questionIds: ["SAMPLE-0001", "SAMPLE-0002"],
      timesMs: [12_000, MAX_ANSWER_TIME_MS],
      unsure: [true, false],
      flagged: [false, true],
    });
    expect((await handlePostResult(post(marked, { cookie }), deps(repository))).status).toBe(200);
    expect((await repository.listResults("a", "EX-SMP-XX")).results).toEqual([marked]);
  });

  it("回答時間・自信なし・見直しのない古い形_受け付ける", async () => {
    expect((await handlePostResult(post(body(), { cookie }), deps())).status).toBe(200);
  });

  it("未回答の問題がある_回答がなくても受け付ける", async () => {
    const unanswered = body({ questionIds: ["SAMPLE-0001", "SAMPLE-0002"], answers: {} });
    expect((await handlePostResult(post(unanswered, { cookie }), deps())).status).toBe(200);
  });

  it("入力が正しくない_応答に入力の値を含めない", async () => {
    const marker = "marker-value-that-must-not-echo";
    const response = await handlePostResult(post(body({ examCode: marker }), { cookie }), deps());
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(marker);
    const listed = await handleListResults(get(`examCode=${marker}`, { cookie }), deps());
    expect(listed.status).toBe(400);
    expect(await listed.text()).not.toContain(marker);
  });

  it("申告された大きさが上限を超える_読み込まずに 413 で断る", async () => {
    const repository = createMemoryRepository();
    const request = post(body(), { cookie, "content-length": "200000" });
    const response = await handlePostResult(request, deps(repository));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too-large" });
  });

  it("エラーの応答_種類だけを持ち_保存しない形で返る", async () => {
    const cases: Array<[Response, number, string]> = [
      [await handlePostResult(post(body()), deps()), 401, "unauthorized"],
      [await handleListResults(get("examCode=EX-SMP-XX"), deps()), 401, "unauthorized"],
      [await handlePostResult(post(body({ extra: 1 }), { cookie }), deps()), 400, "bad-request"],
      [await handleListResults(get("", { cookie }), deps()), 400, "bad-request"],
    ];
    for (const [response, status, error] of cases) {
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("content-type")).toContain("application/json");
    }
  });
});

const failing: HistoryRepository = {
  async deleteUserData() {
    throw new Error("unavailable");
  },
  async putResult() {
    throw new Error("unavailable");
  },
  async getResult() {
    throw new Error("unavailable");
  },
  async updateStats() {
    throw new Error("unavailable");
  },
  async listStats() {
    throw new Error("unavailable");
  },
  async listReviewItems() {
    throw new Error("unavailable");
  },
  async removeReview() {
    throw new Error("unavailable");
  },
  async listResults() {
    throw new Error("unavailable");
  },
  async listBookmarks() {
    throw new Error("unavailable");
  },
  async setBookmark() {
    throw new Error("unavailable");
  },
  async listReview() {
    throw new Error("unavailable");
  },
  async updateReview() {
    throw new Error("unavailable");
  },
  async listDays() {
    throw new Error("unavailable");
  },
  async getGoal() {
    throw new Error("unavailable");
  },
  async setGoal() {
    throw new Error("unavailable");
  },
  async getSections() {
    throw new Error("unavailable");
  },
  async mergeSections() {
    throw new Error("unavailable");
  },
  async getPrefs() {
    throw new Error("unavailable");
  },
  async setPrefs() {
    throw new Error("unavailable");
  },
  async listNotebook() {
    throw new Error("unavailable");
  },
  async completeNotebookEntry() {
    throw new Error("unavailable");
  },
};

describe("履歴の保存先の失敗", () => {
  it("保存先が失敗する_原因を返さず 503 にする", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const saved = await handlePostResult(post(body(), { cookie: asUser("a") }), deps(failing));
    expect(saved.status).toBe(503);
    expect(await saved.json()).toEqual({ error: "unavailable" });
    const listed = await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("a") }), deps(failing));
    expect(listed.status).toBe(503);
    log.mockRestore();
  });

  it("保存先が失敗する_経路・状態・例外の名前だけを記録し_入力と利用者の識別子は出さない", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const marker = "marker-7f3a";
    const repository: HistoryRepository = {
      ...failing,
      async listResults() {
        throw new Error(`failed for ${marker}`);
      },
    };
    await handleListResults(get("examCode=EX-SMP-XX", { cookie: asUser("user-a") }), deps(repository));
    const lines = log.mock.calls.map((call) => call.map(String).join(" "));
    log.mockRestore();
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { event: "api-failure", path: "/api/history/results", status: 503, error: "Error" },
    ]);
    expect(lines.join("\n")).not.toContain(marker);
    expect(lines.join("\n")).not.toContain("user-a");
  });
});

describe("ブックマークの API", () => {
  const questions = async (examCode: string) =>
    examCode === "EX-SMP-XX"
      ? [{ questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["B"] }]
      : null;
  const withQuestions = (repository: HistoryRepository = createMemoryRepository()): HistoryDeps => ({
    ...deps(repository),
    questions,
  });
  const change = (value: Record<string, unknown> = {}) => ({
    examCode: "EX-SMP-XX",
    questionId: "SAMPLE-0001",
    bookmarked: true,
    ...value,
  });
  const put = (value: unknown, headers: Record<string, string> = {}, raw?: string) =>
    new Request(`${ORIGIN}/api/history/bookmarks`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(value),
    });
  const list = (query: string, headers: Record<string, string> = {}) =>
    handleListBookmarks(new Request(`${ORIGIN}/api/history/bookmarks?${query}`, { headers }), current);
  let current: HistoryDeps;

  it("付けて外す_一覧に反映され_繰り返しても結果は変わらない", async () => {
    current = withQuestions();
    for (let i = 0; i < 2; i++) {
      expect((await handlePutBookmark(put(change(), { cookie: asUser("a") }), current)).status).toBe(200);
    }
    expect(await (await list("examCode=EX-SMP-XX", { cookie: asUser("a") })).json()).toEqual({
      questionIds: ["SAMPLE-0001"],
    });
    // 他人には見えない
    expect(await (await list("examCode=EX-SMP-XX", { cookie: asUser("b") })).json()).toEqual({ questionIds: [] });
    await handlePutBookmark(put(change({ bookmarked: false }), { cookie: asUser("a") }), current);
    expect(await (await list("examCode=EX-SMP-XX", { cookie: asUser("a") })).json()).toEqual({ questionIds: [] });
  });

  it("本文が正しくない_400 を返し_保存しない", async () => {
    current = withQuestions();
    const cases: unknown[] = [
      change({ questionId: "SAMPLE-9999" }), // データにない問題
      change({ questionId: "OTHER-0001" }), // 資格と合わない
      change({ examCode: "EX-SM2-XX", questionId: "SAMPLE2-0001" }), // 公開中でない資格
      change({ questionId: "EX-SMP-XX#0001" }),
      change({ bookmarked: "yes" }),
      change({ sub: "other-user" }),
      { examCode: "EX-SMP-XX", questionId: "SAMPLE-0001" },
      [],
      null,
    ];
    for (const value of cases) {
      const response = await handlePutBookmark(put(value, { cookie: asUser("a") }), current);
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad-request" });
    }
    expect(await (await list("examCode=EX-SMP-XX", { cookie: asUser("a") })).json()).toEqual({ questionIds: [] });
  });

  it("未ログイン・別サイト・JSON でない・大きすぎる_それぞれの種類で断る", async () => {
    current = withQuestions();
    expect((await handlePutBookmark(put(change()), current)).status).toBe(401);
    expect(
      (await handlePutBookmark(put(change(), { cookie: asUser("a"), "sec-fetch-site": "cross-site" }), current)).status,
    ).toBe(403);
    expect(
      (await handlePutBookmark(put(change(), { cookie: asUser("a"), "content-type": "text/plain" }), current)).status,
    ).toBe(415);
    expect(
      (await handlePutBookmark(put(null, { cookie: asUser("a") }, JSON.stringify({ pad: "x".repeat(2000) })), current))
        .status,
    ).toBe(413);
    expect((await handlePutBookmark(put(null, { cookie: asUser("a") }, "{"), current)).status).toBe(400);
  });

  it("問い合わせが正しくない_400 を返す", async () => {
    current = withQuestions();
    for (const query of ["", "examCode=sample", "examCode=EX-SMP-XX&examCode=EX-SMP-XX", "examCode=EX-SMP-XX&sub=b"]) {
      expect((await list(query, { cookie: asUser("a") })).status, query).toBe(400);
    }
    expect((await list("examCode=EX-SMP-XX")).status).toBe(401);
  });

  it("保存先が失敗する_原因を返さず 503 にする", async () => {
    current = withQuestions(failing);
    expect((await handlePutBookmark(put(change(), { cookie: asUser("a") }), current)).status).toBe(503);
    expect((await list("examCode=EX-SMP-XX", { cookie: asUser("a") })).status).toBe(503);
  });
});

describe("採点し直して復習プールの変更にする", () => {
  const questions = [
    { questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["B"] },
    { questionId: "SAMPLE-0002", questionType: "multiple" as const, correctAnswers: ["A", "C"] },
    { questionId: "SAMPLE-0003", questionType: "single" as const, correctAnswers: ["A"] },
  ];

  it("正解は外し_不正解と未回答は入れ_データにない問題は無視する", () => {
    const result: Result = {
      examCode: "EX-SMP-XX",
      questionIds: ["SAMPLE-0001", "SAMPLE-0002", "SAMPLE-0003", "SAMPLE-0099"],
      answers: { "SAMPLE-0001": ["B"], "SAMPLE-0002": ["A"], "SAMPLE-0099": ["A"] },
      finishedAt: "2026-10-11T12:00:00.000Z",
    };
    expect(reviewChangeOf(result, questions)).toEqual({
      wrong: ["SAMPLE-0002", "SAMPLE-0003"],
      correct: ["SAMPLE-0001"],
      at: "2026-10-11T12:00:00.000Z",
    });
    // 学習量は、データにある問題だけを数える
    expect(tallyOf(result, questions)).toEqual({ answered: 3, correct: 1 });
  });

  const marked = (over: Partial<Result>): Result => ({
    examCode: "EX-SMP-XX",
    questionIds: ["SAMPLE-0001", "SAMPLE-0002", "SAMPLE-0003"],
    answers: { "SAMPLE-0001": ["B"], "SAMPLE-0002": ["A"] },
    finishedAt: "2026-10-11T12:00:00.000Z",
    ...over,
  });

  it("自信なしの印_正解でも復習に残し_学習量の正答数には数える", () => {
    const result = marked({ unsure: [true, false, false] });
    expect(reviewChangeOf(result, questions)).toEqual({
      wrong: ["SAMPLE-0001", "SAMPLE-0002", "SAMPLE-0003"],
      correct: [],
      at: "2026-10-11T12:00:00.000Z",
    });
    expect(tallyOf(result, questions)).toEqual({ answered: 3, correct: 1 });
  });

  it("見直しの印_採点と復習に影響しない", () => {
    expect(reviewChangeOf(marked({ flagged: [true, true, true] }), questions)).toEqual(
      reviewChangeOf(marked({}), questions),
    );
  });

  it("自由記述の問題_採点基準の判定で正誤を決める(端末の正誤は使わない)", () => {
    const freeText = {
      questionId: "SAMPLE-0006",
      questionType: "free-text" as const,
      rubric: { criteria: [{ name: "観点", keywords: ["止まれ"], points: 10 }], passingPoints: 10 },
    };
    const result = (text: string): Result => ({
      examCode: "EX-SMP-XX",
      questionIds: ["SAMPLE-0006"],
      answers: {},
      textAnswers: { "SAMPLE-0006": text },
      finishedAt: "2026-10-11T12:00:00.000Z",
    });
    expect(reviewChangeOf(result("赤は止まれ"), [freeText])).toMatchObject({ wrong: [], correct: ["SAMPLE-0006"] });
    expect(reviewChangeOf(result("赤は進め"), [freeText])).toMatchObject({ wrong: ["SAMPLE-0006"], correct: [] });
  });
});

describe("日ごとの学習量の API", () => {
  const questions = async (examCode: string) =>
    examCode === "EX-SMP-XX"
      ? [
          { questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["A"] },
          { questionId: "SAMPLE-0002", questionType: "single" as const, correctAnswers: ["B"] },
        ]
      : null;
  const withQuestions = (repository: HistoryRepository = createMemoryRepository()): HistoryDeps => ({
    ...deps(repository),
    questions,
  });
  const days = async (d: HistoryDeps, sub: string, query = "examCode=EX-SMP-XX") => {
    const response = await handleListDays(
      new Request(`${ORIGIN}/api/history/days?${query}`, { headers: { cookie: asUser(sub) } }),
      d,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { days: unknown[] }).days;
  };

  it("結果を保存する_完了した日(日本時間)に_採点し直した問題数と正解数が足される", async () => {
    const d = withQuestions();
    const two = { questionIds: ["SAMPLE-0001", "SAMPLE-0002"], answers: { "SAMPLE-0001": ["A"] } };
    // 日本時間の 10/11 21:00 と、10/12 0:00(UTC では 10/11 15:00)
    await handlePostResult(post(body({ ...two, finishedAt: "2026-10-11T12:00:00.000Z" }), { cookie: asUser("a") }), d);
    await handlePostResult(post(body({ finishedAt: "2026-10-11T14:59:59.999Z" }), { cookie: asUser("a") }), d);
    await handlePostResult(post(body({ finishedAt: "2026-10-11T15:00:00.000Z" }), { cookie: asUser("a") }), d);
    expect(await days(d, "a")).toEqual([
      { date: "2026-10-11", answered: 3, correct: 2 },
      { date: "2026-10-12", answered: 1, correct: 1 },
    ]);
  });

  it("自由記述の問題_採点基準の判定で正解数を数える", async () => {
    const d: HistoryDeps = {
      ...deps(createMemoryRepository()),
      questions: async () => [
        {
          questionId: "SAMPLE-0006",
          questionType: "free-text" as const,
          rubric: { criteria: [{ name: "観点", keywords: ["止まれ"], points: 10 }], passingPoints: 10 },
        },
      ],
    };
    const written = (text: string, finishedAt: string) =>
      body({ questionIds: ["SAMPLE-0006"], answers: {}, textAnswers: { "SAMPLE-0006": text }, finishedAt });
    await handlePostResult(post(written("赤は止まれ", "2026-10-11T12:00:00.000Z"), { cookie: asUser("a") }), d);
    await handlePostResult(post(written("赤は進め", "2026-10-11T12:01:00.000Z"), { cookie: asUser("a") }), d);
    expect(await days(d, "a")).toEqual([{ date: "2026-10-11", answered: 2, correct: 1 }]);
  });

  it("同じ結果を送り直す_二重に数えない", async () => {
    const d = withQuestions();
    for (let i = 0; i < 3; i++) await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    expect(await days(d, "a")).toEqual([{ date: "2026-10-11", answered: 1, correct: 1 }]);
  });

  it("いまのデータにない問題だけの結果と_公開中でない資格の結果_数えない", async () => {
    const d = withQuestions();
    const missing = body({ questionIds: ["SAMPLE-0099"], answers: {} });
    expect((await handlePostResult(post(missing, { cookie: asUser("a") }), d)).status).toBe(200);
    const other = body({ examCode: "EX-OTH-XX", questionIds: ["OTHER-0001"], answers: {} });
    expect((await handlePostResult(post(other, { cookie: asUser("a") }), d)).status).toBe(200);
    expect(await days(d, "a")).toEqual([]);
    expect(await days(d, "a", "examCode=EX-OTH-XX")).toEqual([]);
  });

  it("別の利用者_他人の学習量は見えない", async () => {
    const d = withQuestions();
    await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    expect(await days(d, "b")).toEqual([]);
  });

  it("未ログイン・問い合わせが正しくない・保存先の失敗_それぞれの種類で断る", async () => {
    const list = (query: string, headers: Record<string, string>, d: HistoryDeps) =>
      handleListDays(new Request(`${ORIGIN}/api/history/days?${query}`, { headers }), d);
    expect((await list("examCode=EX-SMP-XX", {}, withQuestions())).status).toBe(401);
    for (const query of ["", "examCode=sample", "examCode=EX-SMP-XX&sub=b", "examCode=EX-SMP-XX&examCode=EX-SMP-XX"]) {
      expect((await list(query, { cookie: asUser("a") }, withQuestions())).status, query).toBe(400);
    }
    const failed = await list("examCode=EX-SMP-XX", { cookie: asUser("a") }, withQuestions(failing));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "unavailable" });
  });
});

describe("目標日の API", () => {
  const questions = async (examCode: string) =>
    examCode === "EX-SMP-XX"
      ? [{ questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["A"] }]
      : null;
  const withQuestions = (repository: HistoryRepository = createMemoryRepository()): HistoryDeps => ({
    ...deps(repository),
    questions,
  });
  const put = (value: unknown, headers: Record<string, string> = {}, raw?: string) =>
    new Request(`${ORIGIN}/api/history/goal`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(value),
    });
  const read = (d: HistoryDeps, sub: string | null, query = "examCode=EX-SMP-XX") =>
    handleGetGoal(
      new Request(`${ORIGIN}/api/history/goal?${query}`, { headers: sub ? { cookie: asUser(sub) } : {} }),
      d,
    );

  it("決めて取得し_消す_自分の分だけに反映される", async () => {
    const d = withQuestions();
    expect(await (await read(d, "a")).json()).toEqual({ date: null });
    const saved = await handlePutGoal(put({ examCode: "EX-SMP-XX", date: "2026-12-20" }, { cookie: asUser("a") }), d);
    expect(saved.status).toBe(200);
    expect(await (await read(d, "a")).json()).toEqual({ date: "2026-12-20" });
    expect(await (await read(d, "b")).json()).toEqual({ date: null });
    await handlePutGoal(put({ examCode: "EX-SMP-XX", date: null }, { cookie: asUser("a") }), d);
    expect(await (await read(d, "a")).json()).toEqual({ date: null });
  });

  it("本文が正しくない_400 を返し_保存しない", async () => {
    const d = withQuestions();
    const cases: unknown[] = [
      { examCode: "EX-SMP-XX", date: "2026-02-30" },
      { examCode: "EX-SMP-XX", date: "2026/12/20" },
      { examCode: "EX-SMP-XX", date: "2026-12-20T00:00:00.000Z" },
      { examCode: "EX-SMP-XX", date: "" },
      { examCode: "EX-SMP-XX", date: "2019-12-31" },
      { examCode: "EX-SMP-XX", date: "2100-01-01" },
      { examCode: "EX-SMP-XX", date: 20261220 },
      { examCode: "EX-SMP-XX" },
      { examCode: "EX-OTH-XX", date: "2026-12-20" }, // 公開中でない資格
      { examCode: "sample", date: "2026-12-20" },
      { examCode: "EX-SMP-XX", date: "2026-12-20", sub: "other-user" },
      [],
      null,
    ];
    for (const value of cases) {
      const response = await handlePutGoal(put(value, { cookie: asUser("a") }), d);
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad-request" });
    }
    expect(await (await read(d, "a")).json()).toEqual({ date: null });
  });

  it("範囲の端の日付_受け付ける", async () => {
    const d = withQuestions();
    for (const date of ["2020-01-01", "2099-12-31", "2028-02-29"]) {
      expect((await handlePutGoal(put({ examCode: "EX-SMP-XX", date }, { cookie: asUser("a") }), d)).status, date).toBe(
        200,
      );
    }
  });

  it("未ログイン・別サイト・JSON でない・大きすぎる・保存先の失敗_それぞれの種類で断る", async () => {
    const d = withQuestions();
    const goal = { examCode: "EX-SMP-XX", date: "2026-12-20" };
    expect((await handlePutGoal(put(goal), d)).status).toBe(401);
    expect((await read(d, null)).status).toBe(401);
    expect((await handlePutGoal(put(goal, { cookie: asUser("a"), "sec-fetch-site": "cross-site" }), d)).status).toBe(
      403,
    );
    expect((await handlePutGoal(put(goal, { cookie: asUser("a"), "content-type": "text/plain" }), d)).status).toBe(415);
    expect(
      (await handlePutGoal(put(null, { cookie: asUser("a") }, JSON.stringify({ pad: "x".repeat(2000) })), d)).status,
    ).toBe(413);
    expect((await handlePutGoal(put(null, { cookie: asUser("a") }, "{"), d)).status).toBe(400);
    for (const query of ["", "examCode=EX-SMP-XX&sub=b"]) expect((await read(d, "a", query)).status, query).toBe(400);
    expect((await handlePutGoal(put(goal, { cookie: asUser("a") }), withQuestions(failing))).status).toBe(503);
    expect((await read(withQuestions(failing), "a")).status).toBe(503);
  });
});

describe("1 回分の結果・集計・復習の項目の API", () => {
  const cookie = asUser("a");
  const at = "2026-10-11T12:00:00.000Z";
  const withQuestions = (repository = createMemoryRepository()): HistoryDeps => ({
    ...deps(repository),
    questions: async () => [{ questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["A"] }],
  });
  const getAt = (path: string) => new Request(`${ORIGIN}${path}`, { headers: { cookie } });
  const del = (value: unknown) =>
    new Request(`${ORIGIN}/api/history/review`, {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(value),
    });

  it("1 回分の結果_あれば返し_なければ 404_問い合わせが正しくなければ 400", async () => {
    const d = withQuestions();
    await handlePostResult(post(body({ finishedAt: at }), { cookie }), d);
    const found = await handleGetResult(getAt(`/api/history/result?examCode=EX-SMP-XX&finishedAt=${at}`), d);
    expect(await found.json()).toEqual({ result: body({ finishedAt: at }) });
    const missing = await handleGetResult(
      getAt("/api/history/result?examCode=EX-SMP-XX&finishedAt=2026-10-11T12:01:00.000Z"),
      d,
    );
    expect(missing.status).toBe(404);
    for (const query of ["examCode=EX-SMP-XX", `finishedAt=${at}`, `examCode=EX-SMP-XX&finishedAt=yesterday`]) {
      expect((await handleGetResult(getAt(`/api/history/result?${query}`), d)).status, query).toBe(400);
    }
  });

  it("保存で解答回数と直近の正誤を数え_送り直しでは数えない", async () => {
    const d = withQuestions();
    await handlePostResult(post(body({ finishedAt: at }), { cookie }), d);
    await handlePostResult(post(body({ finishedAt: at }), { cookie }), d);
    const response = await handleListStats(getAt("/api/history/stats?examCode=EX-SMP-XX"), d);
    expect(await response.json()).toEqual({ stats: [{ questionId: "SAMPLE-0001", count: 1, recent: [true] }] });
  });

  it("復習の項目_問い合わせを付けると 400_外す本文が正しくなければ 400", async () => {
    const d = withQuestions();
    expect((await handleListReviewItems(getAt("/api/history/review/all?examCode=EX-SMP-XX"), d)).status).toBe(400);
    expect(await (await handleListReviewItems(getAt("/api/history/review/all"), d)).json()).toEqual({ items: [] });
    for (const bad of [
      { examCode: "EX-SMP-XX" },
      { examCode: "EX-SMP-XX#", questionId: "SAMPLE-0001" },
      { examCode: "EX-SMP-XX", questionId: "SAMPLE-0001", extra: 1 },
    ]) {
      expect((await handleDeleteReview(del(bad), d)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await handleDeleteReview(del({ examCode: "EX-SMP-XX", questionId: "SAMPLE-0001" }), d)).status).toBe(200);
  });
});

describe("表示の設定の API", () => {
  const prefs = { theme: "dark", style: "simple", shuffleChoices: true } as const;
  const put = (value: unknown, headers: Record<string, string> = {}, raw?: string) =>
    new Request(`${ORIGIN}/api/history/prefs`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(value),
    });
  const read = (d: HistoryDeps, sub: string | null, query = "") =>
    handleGetPrefs(
      new Request(`${ORIGIN}/api/history/prefs${query}`, { headers: sub ? { cookie: asUser(sub) } : {} }),
      d,
    );
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .find((c) => c.startsWith(`${PREFS_COOKIE}=`))
      ?.split(";")[0]
      ?.slice(PREFS_COOKIE.length + 1);

  it("保存していない_null を返し_設定の Cookie は付けない", async () => {
    const response = await read(deps(), "a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prefs: null });
    expect(cookieOf(response)).toBeUndefined();
  });

  it("保存して取得する_自分の分だけに反映され_別の利用者には見えない", async () => {
    const d = deps();
    const saved = await handlePutPrefs(put(prefs, { cookie: asUser("a") }), d);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ status: "saved" });
    expect(await (await read(d, "a")).json()).toEqual({ prefs });
    expect(await (await read(d, "b")).json()).toEqual({ prefs: null });
  });

  it("保存する_設定の Cookie を付け_持ち主は保存した利用者(別の利用者では使えない)", async () => {
    const response = await handlePutPrefs(put(prefs, { cookie: asUser("a") }), deps());
    const value = cookieOf(response);
    expect(parsePrefsCookie(value, "a")).toEqual(prefs);
    expect(parsePrefsCookie(value, "b")).toBeNull();
    expect(response.headers.getSetCookie().join(";")).toContain("HttpOnly");
  });

  it("取得する_保存済みなら設定の Cookie を付ける(別の端末でも、次の描画から反映できる)", async () => {
    const d = deps();
    await handlePutPrefs(put(prefs, { cookie: asUser("a") }), d);
    const response = await read(d, "a");
    expect(parsePrefsCookie(cookieOf(response), "a")).toEqual(prefs);
  });

  it("上書きする_最後に保存した設定になる", async () => {
    const d = deps();
    await handlePutPrefs(put(prefs, { cookie: asUser("a") }), d);
    const next = { theme: "light", style: "rich", shuffleChoices: false };
    await handlePutPrefs(put(next, { cookie: asUser("a") }), d);
    expect(await (await read(d, "a")).json()).toEqual({ prefs: next });
  });

  it("本文に別の利用者の識別子・未知の項目_断り_自分にも相手にも保存しない", async () => {
    const repository = createMemoryRepository();
    const d = deps(repository);
    for (const key of ["sub", "userId", "PK", "SK", "owner"]) {
      const response = await handlePutPrefs(put({ ...prefs, [key]: "b" }, { cookie: asUser("a") }), d);
      expect(response.status, key).toBe(400);
    }
    expect(await repository.getPrefs("a")).toBeNull();
    expect(await repository.getPrefs("b")).toBeNull();
  });

  it("値が正しくない_400 を返し_保存しない_応答に入力の値を含めない", async () => {
    const repository = createMemoryRepository();
    const d = deps(repository);
    for (const value of [
      { ...prefs, theme: "目印XYZ" },
      { ...prefs, style: 1 },
      { ...prefs, shuffleChoices: "true" },
      { theme: "dark" },
      [],
      "x",
    ]) {
      const response = await handlePutPrefs(put(value, { cookie: asUser("a") }), d);
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(JSON.stringify(await response.json())).not.toContain("目印XYZ");
    }
    expect(await repository.getPrefs("a")).toBeNull();
  });

  it("問い合わせのパラメーターで別の利用者を指す_取得を断る", async () => {
    expect((await read(deps(), "a", "?sub=b")).status).toBe(400);
    expect((await read(deps(), "a", "?userId=b")).status).toBe(400);
  });

  it("未ログイン・別サイト・JSON でない・JSON が壊れている・大きすぎる_それぞれの種類で断る", async () => {
    const d = deps();
    expect((await read(d, null)).status).toBe(401);
    expect((await handlePutPrefs(put(prefs), d)).status).toBe(401);
    expect((await handlePutPrefs(put(prefs, { cookie: asUser("a"), "sec-fetch-site": "cross-site" }), d)).status).toBe(
      403,
    );
    expect((await handlePutPrefs(put(prefs, { cookie: asUser("a"), "content-type": "text/plain" }), d)).status).toBe(
      415,
    );
    expect((await handlePutPrefs(put(null, { cookie: asUser("a") }, "{broken"), d)).status).toBe(400);
    const big = put(null, { cookie: asUser("a") }, JSON.stringify({ ...prefs, pad: "a".repeat(1000) }));
    expect((await handlePutPrefs(big, d)).status).toBe(413);
  });

  it("保存先が失敗する_原因を返さず 503 にする", async () => {
    const saved = await handlePutPrefs(put(prefs, { cookie: asUser("a") }), deps(failing));
    expect(saved.status).toBe(503);
    expect(await saved.json()).toEqual({ error: "unavailable" });
    expect((await read(deps(failing), "a")).status).toBe(503);
  });
});

describe("体系ノートの節の完了の API", () => {
  // 検証済みの見出し(見出しの ID から、属する中分類の ID)
  const notebookEntries = async (examCode: string) =>
    examCode === "EX-SMP-XX"
      ? new Map([
          ["term-a", "domain1-1"],
          ["term-b", "domain1-1"],
          ["term-c", "domain1-2"],
        ])
      : null;
  const withNotebook = (repository: HistoryRepository = createMemoryRepository(), now = NOW): HistoryDeps => ({
    ...deps(repository),
    now: () => now,
    notebookEntries,
  });
  const put = (value: unknown, headers: Record<string, string> = {}, raw?: string) =>
    new Request(`${ORIGIN}/api/history/notebook`, {
      method: "PUT",
      headers: { "content-type": "application/json", ...headers },
      body: raw ?? JSON.stringify(value),
    });
  const read = (d: HistoryDeps, sub: string | null, query = "examCode=EX-SMP-XX") =>
    handleGetNotebook(
      new Request(`${ORIGIN}/api/history/notebook?${query}`, { headers: sub ? { cookie: asUser(sub) } : {} }),
      d,
    );
  const change = { examCode: "EX-SMP-XX", unit: "domain1-2", entry: "term-c" };

  it("記録して取得する_自分の分だけを_サーバーの時刻で返す", async () => {
    const d = withNotebook();
    expect(await (await read(d, "a")).json()).toEqual({ units: [], entries: [] });
    const saved = await handlePutNotebook(put(change, { cookie: asUser("a") }), d);
    expect(saved.status).toBe(200);
    expect(await (await read(d, "a")).json()).toEqual({
      units: [],
      entries: [{ unit: "domain1-2", entry: "term-c", completedAt: new Date(NOW).toISOString() }],
    });
    expect(await (await read(d, "b")).json()).toEqual({ units: [], entries: [] });
  });

  it("同じ節を後から記録し直す_最初の時刻を残す", async () => {
    const repository = createMemoryRepository();
    const first = { examCode: "EX-SMP-XX", unit: "domain1-1", entry: "term-a" };
    await handlePutNotebook(put(first, { cookie: asUser("a") }), withNotebook(repository, NOW));
    const again = await handlePutNotebook(put(first, { cookie: asUser("a") }), withNotebook(repository, NOW + 60_000));
    expect(again.status).toBe(200);
    expect(await (await read(withNotebook(repository), "a")).json()).toEqual({
      units: [],
      entries: [{ unit: "domain1-1", entry: "term-a", completedAt: new Date(NOW).toISOString() }],
    });
  });

  it("中分類の旧い記録がある_応答の units に返し_節の完了も普通に書く", async () => {
    const { items, client } = fakeTable();
    const at = "2026-10-01T00:00:00.000Z";
    items.set("USER#a|NOTEBOOK#EX-SMP-XX#domain1-1", {
      PK: "USER#a",
      SK: "NOTEBOOK#EX-SMP-XX#domain1-1",
      type: "notebook",
      examCode: "EX-SMP-XX",
      unit: "domain1-1",
      completedAt: at,
    });
    const d = withNotebook(createDynamoRepository({ tableName: "table-example", client }));
    const saved = await handlePutNotebook(
      put({ examCode: "EX-SMP-XX", unit: "domain1-1", entry: "term-a" }, { cookie: asUser("a") }),
      d,
    );
    expect(saved.status).toBe(200);
    expect(await (await read(d, "a")).json()).toEqual({
      units: [{ unit: "domain1-1", completedAt: at }],
      entries: [{ unit: "domain1-1", entry: "term-a", completedAt: new Date(NOW).toISOString() }],
    });
  });

  it("本文が正しくない_ノートにない・属さない・旧い本文・時刻や sub を含む_400 を返し_保存しない", async () => {
    const d = withNotebook();
    const cases: unknown[] = [
      { examCode: "EX-SMP-XX", unit: "domain1-1", entry: "no-such-term" }, // ノートにない(または未検証の)見出し
      { examCode: "EX-SMP-XX", unit: "domain9-9", entry: "term-a" }, // ノートにない中分類
      { examCode: "EX-SMP-XX", unit: "domain1-2", entry: "term-a" }, // 見出しがその中分類に属さない
      { examCode: "EX-OTH-XX", unit: "domain1-1", entry: "term-a" }, // ノートのない資格
      { examCode: "EX-SMP-XX", unit: "domain1-1" }, // entry のない旧い本文
      { examCode: "EX-SMP-XX", unit: "domain1", entry: "term-a" },
      { examCode: "EX-SMP-XX", unit: "domain1-1", entry: "" },
      { examCode: "EX-SMP-XX", unit: "domain1-1", entry: "Term A" },
      { examCode: "EX-SMP-XX", entry: "term-a" },
      { examCode: "sample", unit: "domain1-1", entry: "term-a" },
      { examCode: "EX-SMP-XX", unit: "domain1-1", entry: "term-a", completedAt: "2026-01-01T00:00:00.000Z" },
      { examCode: "EX-SMP-XX", unit: "domain1-1", entry: "term-a", sub: "other-user" },
      [],
      null,
    ];
    for (const value of cases) {
      const response = await handlePutNotebook(put(value, { cookie: asUser("a") }), d);
      expect(response.status, JSON.stringify(value)).toBe(400);
      expect(await response.json()).toEqual({ error: "bad-request" });
    }
    expect(await (await read(d, "a")).json()).toEqual({ units: [], entries: [] });
  });

  it("未ログイン・別サイト・JSON でない・大きすぎる・未知の問い合わせ・保存先の失敗_それぞれの種類で断る", async () => {
    const d = withNotebook();
    expect((await handlePutNotebook(put(change), d)).status).toBe(401);
    expect((await read(d, null)).status).toBe(401);
    expect(
      (await handlePutNotebook(put(change, { cookie: asUser("a"), "sec-fetch-site": "cross-site" }), d)).status,
    ).toBe(403);
    expect(
      (await handlePutNotebook(put(change, { cookie: asUser("a"), "content-type": "text/plain" }), d)).status,
    ).toBe(415);
    expect(
      (await handlePutNotebook(put(null, { cookie: asUser("a") }, JSON.stringify({ pad: "x".repeat(2000) })), d))
        .status,
    ).toBe(413);
    expect((await handlePutNotebook(put(null, { cookie: asUser("a") }, "{"), d)).status).toBe(400);
    for (const query of ["", "examCode=EX-SMP-XX&sub=b"]) expect((await read(d, "a", query)).status, query).toBe(400);
    expect((await handlePutNotebook(put(change, { cookie: asUser("a") }), withNotebook(failing))).status).toBe(503);
    expect((await read(withNotebook(failing), "a")).status).toBe(503);
  });
});
