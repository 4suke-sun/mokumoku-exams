import { describe, expect, it } from "vitest";
import { createFakeProvider, createFakeVerifier, FAKE_USER_EMAIL, FAKE_USER_PHRASE } from "@/lib/auth/fake.ts";
import { withTokenCookies } from "@/lib/auth/session.ts";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { MAX_RESULTS, type Result } from "@/lib/storage.ts";
import { type HistoryDeps, handleListResults, handlePostResult } from "./handlers.ts";
import { createMemoryRepository, type HistoryRepository } from "./repository.ts";

const ORIGIN = "http://localhost";

/** トークンの文字列から利用者を決める検証(署名の検証そのものは verify.test.ts で確かめる) */
const verifier: TokenVerifier = {
  async verifyIdToken(token) {
    return token.startsWith("token-") ? { sub: token.slice("token-".length) } : null;
  },
};
const noRefresh = {
  async refresh() {
    throw new Error("unavailable");
  },
} as unknown as AuthProvider;

function deps(repository: HistoryRepository = createMemoryRepository()): HistoryDeps {
  return { auth: { verifier, provider: noRefresh, secure: false }, repository };
}

const asUser = (sub: string) => `mokumoku_id=token-${sub}`;
const body = (result: Partial<Result> & Record<string, unknown> = {}) => ({
  examCode: "SAMPLE",
  questionIds: ["Q-0001"],
  answers: { "Q-0001": ["A"] },
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
    expect((await handleListResults(get("examCode=SAMPLE"), d)).status).toBe(401);
    expect((await handlePostResult(post(body()), d)).status).toBe(401);
  });

  it("検証に通らないトークン_401 で断り_何も保存しない", async () => {
    const repository = createMemoryRepository();
    const d = deps(repository);
    const response = await handlePostResult(post(body(), { cookie: "mokumoku_id=forged" }), d);
    expect(response.status).toBe(401);
    expect(await repository.listResults("forged", "SAMPLE")).toEqual([]);
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
    expect((await handleListResults(get("examCode=SAMPLE", { cookie: asUser("a") }), d)).status).toBe(401);
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
    const response = await handleListResults(get("examCode=SAMPLE", { cookie }), d);
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
    const listed = await handleListResults(get("examCode=SAMPLE", { cookie: asUser("a") }), d);
    expect(((await listed.json()) as { results: Result[] }).results).toHaveLength(1);
  });

  it("別の利用者_他人の結果は取得できない", async () => {
    const d = deps();
    await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    const listed = await handleListResults(get("examCode=SAMPLE", { cookie: asUser("b") }), d);
    expect(((await listed.json()) as { results: Result[] }).results).toEqual([]);
  });

  it("本文に別の利用者の識別子を入れた_断り_自分にも相手にも保存しない", async () => {
    const repository = createMemoryRepository();
    const d = deps(repository);
    for (const key of ["sub", "userId", "PK", "SK"]) {
      const response = await handlePostResult(post(body({ [key]: "user-a" }), { cookie: asUser("b") }), d);
      expect(response.status).toBe(400);
    }
    expect(await repository.listResults("a", "SAMPLE")).toEqual([]);
    expect(await repository.listResults("b", "SAMPLE")).toEqual([]);
    expect(await repository.listResults("user-a", "SAMPLE")).toEqual([]);
  });

  it("問い合わせに別の利用者の識別子を入れた_断る", async () => {
    const d = deps();
    const response = await handleListResults(get("examCode=SAMPLE&sub=a", { cookie: asUser("b") }), d);
    expect(response.status).toBe(400);
  });

  it("同じ結果を繰り返し送る_重複しない", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) await handlePostResult(post(body(), { cookie: asUser("a") }), d);
    const listed = await handleListResults(get("examCode=SAMPLE", { cookie: asUser("a") }), d);
    expect(((await listed.json()) as { results: Result[] }).results).toHaveLength(1);
  });

  it("上限を超えて送る_新しい順に上限の件数だけ残る", async () => {
    const d = deps();
    for (let minute = 0; minute <= MAX_RESULTS; minute++) {
      const finishedAt = new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString();
      await handlePostResult(post(body({ finishedAt }), { cookie: asUser("a") }), d);
    }
    const listed = await handleListResults(get("examCode=SAMPLE", { cookie: asUser("a") }), d);
    const results = ((await listed.json()) as { results: Result[] }).results;
    expect(results).toHaveLength(MAX_RESULTS);
    expect(results[0]?.finishedAt).toBe(new Date(Date.UTC(2026, 9, 11, 12, MAX_RESULTS)).toISOString());
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
    const big = body({ answers: { "Q-0001": ["A"] }, questionIds: Array.from({ length: 500 }, () => "Q".repeat(64)) });
    const response = await handlePostResult(
      post(big, { cookie }, JSON.stringify(big).padEnd(200_000, " ")),
      deps(repository),
    );
    expect(response.status).toBe(413);
    expect(await repository.listResults("a", "SAMPLE")).toEqual([]);
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
});

describe("履歴の保存先の失敗", () => {
  const failing: HistoryRepository = {
    async putResult() {
      throw new Error("unavailable");
    },
    async listResults() {
      throw new Error("unavailable");
    },
  };

  it("保存先が失敗する_原因を返さず 503 にする", async () => {
    const saved = await handlePostResult(post(body(), { cookie: asUser("a") }), deps(failing));
    expect(saved.status).toBe(503);
    expect(await saved.json()).toEqual({ error: "unavailable" });
    const listed = await handleListResults(get("examCode=SAMPLE", { cookie: asUser("a") }), deps(failing));
    expect(listed.status).toBe(503);
  });
});
