import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/history/results/route.ts";
import { FAKE_USER_EMAIL, FAKE_USER_PHRASE } from "@/lib/auth/fake.ts";
import { getAuthProvider } from "@/lib/auth/index.ts";
import { withTokenCookies } from "@/lib/auth/session.ts";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import type { Result } from "@/lib/storage.ts";
import { proxy } from "@/proxy.ts";
import { type HistoryDeps, handleListResults, handleListReview, handlePostResult } from "./handlers.ts";
import { createDynamoRepository, type DocumentSender } from "./repository.ts";
import { fakeTable } from "./table-double.ts";

// 保存から取得までを通して確かめる。保存先は、DynamoDB の本物の実装(createDynamoRepository)に、
// 手元で動く代替のテーブル(table-double.ts)をつないだもの。ネットワークにも AWS にも出ない。

const ORIGIN = "http://localhost";
const NOW = Date.parse("2026-10-12T00:00:00.000Z");

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

function stack(wrap: (client: DocumentSender) => DocumentSender = (client) => client) {
  const table = fakeTable();
  const repository = createDynamoRepository({ tableName: "table-example", client: wrap(table.client) });
  const deps: HistoryDeps = { auth: { verifier, provider: noRefresh, secure: false }, repository, now: () => NOW };
  return { table, deps };
}

const cookieOf = (sub: string) => `mokumoku_id=token-${sub}`;
const minute = (n: number) => new Date(Date.UTC(2026, 9, 11, 12, n)).toISOString();
/** 保存先の項目のうち、結果の項目の数(復習プールなどの項目は数えない) */
const resultItems = (table: ReturnType<typeof fakeTable>) =>
  [...table.items.values()].filter((item) => String(item.SK).startsWith("RESULT#")).length;

function attempt(finishedAt: string, extra: Partial<Result> = {}): Result {
  return {
    examCode: "EX-SMP-XX",
    questionIds: ["SAMPLE-0001", "SAMPLE-0002"],
    answers: { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["B", "C"] },
    choiceOrder: { "SAMPLE-0001": ["B", "A"] },
    finishedAt,
    ...extra,
  };
}

const post = (result: unknown, sub: string | null, raw?: string) =>
  new Request(`${ORIGIN}/api/history/results`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(sub ? { cookie: cookieOf(sub) } : {}) },
    body: raw ?? JSON.stringify(result),
  });

const list = (examCode: string, sub: string | null) =>
  new Request(`${ORIGIN}/api/history/results?examCode=${examCode}`, {
    headers: sub ? { cookie: cookieOf(sub) } : {},
  });

async function results(deps: HistoryDeps, examCode: string, sub: string): Promise<Result[]> {
  const response = await handleListResults(list(examCode, sub), deps);
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: Result[] }).results;
}

describe("履歴の保存と取得の通し", () => {
  it("保存した結果_すべての項目がそのまま取得できる", async () => {
    const { deps } = stack();
    const saved = attempt(minute(1));
    expect((await handlePostResult(post(saved, "a"), deps)).status).toBe(200);
    expect(await results(deps, "EX-SMP-XX", "a")).toEqual([saved]);
  });

  it("選択肢の並びがない結果_並びなしのまま取得できる", async () => {
    const { deps } = stack();
    const saved = attempt(minute(1));
    delete saved.choiceOrder;
    await handlePostResult(post(saved, "a"), deps);
    expect(await results(deps, "EX-SMP-XX", "a")).toEqual([saved]);
  });

  it("同じ問題を複数回解く_回ごとの結果が積み上がり_新しい順に返る", async () => {
    const { deps } = stack();
    const first = attempt(minute(1), { answers: { "SAMPLE-0001": ["B"] } });
    const second = attempt(minute(5), { answers: { "SAMPLE-0001": ["A"] } });
    const third = attempt(minute(9), { answers: { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["C"] } });
    // 保存の順は、時刻の順とは限らない
    for (const result of [second, first, third]) await handlePostResult(post(result, "a"), deps);
    expect(await results(deps, "EX-SMP-XX", "a")).toEqual([third, second, first]);
  });

  it("同じ完了時刻の結果を送り直す_重複せず_あとから送った内容に置き換わる", async () => {
    const { deps, table } = stack();
    await handlePostResult(post(attempt(minute(1), { answers: { "SAMPLE-0001": ["B"] } }), "a"), deps);
    await handlePostResult(post(attempt(minute(1), { answers: { "SAMPLE-0001": ["A"] } }), "a"), deps);
    const found = await results(deps, "EX-SMP-XX", "a");
    expect(found).toHaveLength(1);
    expect(found[0]?.answers["SAMPLE-0001"]).toEqual(["A"]);
    expect(resultItems(table)).toBe(1);
  });

  it("件数の上限なしで残し_保存先の項目もすべて残る", async () => {
    const { deps, table } = stack();
    const total = 15;
    for (let n = 0; n < total; n++) await handlePostResult(post(attempt(minute(n)), "a"), deps);
    const found = await results(deps, "EX-SMP-XX", "a");
    expect(found).toHaveLength(total);
    expect(found[0]?.finishedAt).toBe(minute(total - 1));
    expect(found.at(-1)?.finishedAt).toBe(minute(0));
    expect(resultItems(table)).toBe(total);
  });

  it("古い時刻の結果をあとから送る_時刻の順に並ぶ", async () => {
    const { deps } = stack();
    for (let n = 10; n < 13; n++) await handlePostResult(post(attempt(minute(n)), "a"), deps);
    await handlePostResult(post(attempt(minute(1)), "a"), deps);
    expect((await results(deps, "EX-SMP-XX", "a")).map((r) => r.finishedAt)).toEqual([
      minute(12),
      minute(11),
      minute(10),
      minute(1),
    ]);
  });

  it("資格が違う_資格ごとに別々に数え_別の資格の結果は混ざらない", async () => {
    const { deps } = stack();
    const other = (n: number) =>
      attempt(minute(n), {
        examCode: "EX-OTH-XX",
        questionIds: ["OTHER-0001"],
        answers: { "OTHER-0001": ["A"] },
        choiceOrder: { "OTHER-0001": ["B", "A"] },
      });
    for (let n = 0; n < 3; n++) await handlePostResult(post(attempt(minute(n)), "a"), deps);
    await handlePostResult(post(other(1), "a"), deps);
    expect(await results(deps, "EX-SMP-XX", "a")).toHaveLength(3);
    expect((await results(deps, "EX-OTH-XX", "a")).map((r) => r.examCode)).toEqual(["EX-OTH-XX"]);
  });

  it("利用者が違う_互いの結果が見えない", async () => {
    const { deps } = stack();
    await handlePostResult(post(attempt(minute(1)), "b"), deps);
    for (let n = 0; n < 3; n++) await handlePostResult(post(attempt(minute(n)), "a"), deps);
    expect(await results(deps, "EX-SMP-XX", "a")).toHaveLength(3);
    expect(await results(deps, "EX-SMP-XX", "b")).toEqual([attempt(minute(1))]);
    expect(await results(deps, "EX-SMP-XX", "c")).toEqual([]);
  });

  it("結果がまだない資格_空の一覧が返る", async () => {
    const { deps } = stack();
    expect(await results(deps, "EX-SMP-XX", "a")).toEqual([]);
  });
});

describe("履歴の通しでのエラー応答", () => {
  it("入力が正しくない_400 を返し_保存先を呼ばない", async () => {
    const { deps, table } = stack();
    const bad = [
      attempt(minute(1), { questionIds: ["SAMPLE-0001", "SAMPLE-0001"] }),
      attempt("2026-10-13T12:00:00.000Z"),
      { ...attempt(minute(1)), sub: "b" },
    ];
    for (const result of bad) {
      const response = await handlePostResult(post(result, "a"), deps);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "bad-request" });
    }
    expect(table.sent).toHaveLength(0);
  });

  it("未ログイン_401 を返し_保存先を呼ばない", async () => {
    const { deps, table } = stack();
    expect((await handlePostResult(post(attempt(minute(1)), null), deps)).status).toBe(401);
    expect((await handleListResults(list("EX-SMP-XX", null), deps)).status).toBe(401);
    expect(table.sent).toHaveLength(0);
  });

  it("本文が JSON でない_400 を返し_保存先を呼ばない", async () => {
    const { deps, table } = stack();
    const response = await handlePostResult(post(undefined, "a", "{broken"), deps);
    expect(response.status).toBe(400);
    expect(table.sent).toHaveLength(0);
  });

  it("保存先が失敗する_原因を返さず 503 にし_送り直せば保存できる", async () => {
    let failPut = true;
    const { deps, table } = stack((client) => ({
      async send(command) {
        if (command instanceof PutCommand && failPut) throw new Error("internal detail");
        return client.send(command);
      },
    }));
    const failed = await handlePostResult(post(attempt(minute(1)), "a"), deps);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("internal detail");
    failPut = false;
    expect((await handlePostResult(post(attempt(minute(1)), "a"), deps)).status).toBe(200);
    expect(resultItems(table)).toBe(1);
  });

  it("問題ごとの集計の途中で失敗して送り直す_日ごとの学習量と解答回数は一度だけ数える", async () => {
    let failStats = true;
    const { deps, table } = stack((client) => ({
      async send(command) {
        if (command instanceof GetCommand && failStats) throw new Error("internal detail");
        return client.send(command);
      },
    }));
    deps.questions = async () => [
      { questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["A"] },
      { questionId: "SAMPLE-0002", questionType: "multiple" as const, correctAnswers: ["B", "C"] },
    ];
    expect((await handlePostResult(post(attempt(minute(1)), "a"), deps)).status).toBe(503);
    failStats = false;
    expect((await handlePostResult(post(attempt(minute(1)), "a"), deps)).status).toBe(200);
    expect(table.items.get("USER#a|DAY#EX-SMP-XX#2026-10-11")?.answered).toBe(2);
    // 結果の項目は 1 回目に作られているので、送り直しでは解答回数を数えない(集計の取りこぼしは許す)
    expect(table.items.get("USER#a|STAT#EX-SMP-XX#SAMPLE-0001")).toBeUndefined();
  });
});

describe("入口(proxy)から API までの通し", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_FAKE", "1");
    // 手元の代替の保存先は、プロセスの中で共有されるので、テストごとに空にする
    delete (globalThis as { __mokumokuFakeHistory?: unknown }).__mokumokuFakeHistory;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loginCookie(): Promise<string> {
    const signedIn = await getAuthProvider().signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    if (signedIn.kind !== "signed-in") throw new Error("unexpected");
    return withTokenCookies(null, signedIn.tokens);
  }

  const nextPost = (cookie: string | null, body: unknown) =>
    new NextRequest(`${ORIGIN}/api/history/results`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const nextGet = (cookie: string | null) =>
    new NextRequest(`${ORIGIN}/api/history/results?examCode=EX-SMP-XX`, { headers: cookie ? { cookie } : {} });

  it("ログインして保存し取得する_入口を通り_結果が返る", async () => {
    const cookie = await loginCookie();
    const saved = attempt(new Date().toISOString());
    expect((await proxy(nextPost(cookie, saved))).status).toBe(200);
    expect((await POST(nextPost(cookie, saved))).status).toBe(200);
    expect((await proxy(nextGet(cookie))).status).toBe(200);
    const response = await GET(nextGet(cookie));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { results: Result[] }).results).toEqual([saved]);
  });

  it("未ログイン_入口で断られ_API の本体も断る", async () => {
    const saved = attempt(new Date().toISOString());
    expect((await proxy(nextPost(null, saved))).status).toBe(401);
    expect((await POST(nextPost(null, saved))).status).toBe(401);
    expect((await proxy(nextGet(null))).status).toBe(401);
    expect((await GET(nextGet(null))).status).toBe(401);
  });
});

describe("復習プールの通し", () => {
  const review = async (deps: HistoryDeps, sub: string) => {
    const response = await handleListReview(
      new Request(`${ORIGIN}/api/history/review?examCode=EX-SMP-XX`, { headers: { cookie: cookieOf(sub) } }),
      deps,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { questionIds: string[] }).questionIds;
  };
  // 問題データで決まる正解(端末から送られた正誤は使わない)
  const questions = async () => [
    { questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["B"] },
    { questionId: "SAMPLE-0002", questionType: "multiple" as const, correctAnswers: ["A", "C"] },
  ];

  it("間違えた問題と未回答の問題_復習プールに入り_正解した問題は入らない", async () => {
    const { deps } = stack();
    deps.questions = questions;
    const answers = { "SAMPLE-0001": ["B"] };
    expect((await handlePostResult(post(attempt(minute(1), { answers }), "a"), deps)).status).toBe(200);
    expect(await review(deps, "a")).toEqual(["SAMPLE-0002"]);
  });

  it("復習プールの問題に 2 回続けて正解する_プールから抜け_自信なしの正解は連続に数えない", async () => {
    const { deps } = stack();
    deps.questions = questions;
    await handlePostResult(post(attempt(minute(1)), "a"), deps);
    expect(await review(deps, "a")).toEqual(["SAMPLE-0001", "SAMPLE-0002"]);
    const answers = { "SAMPLE-0001": ["B"], "SAMPLE-0002": ["C", "A"] };
    await handlePostResult(post(attempt(minute(2), { answers }), "a"), deps);
    expect(await review(deps, "a")).toEqual(["SAMPLE-0001", "SAMPLE-0002"]);
    // 2 問目は自信なし: 正解でも連続が 0 に戻る
    await handlePostResult(post(attempt(minute(3), { answers, unsure: [false, true] }), "a"), deps);
    expect(await review(deps, "a")).toEqual(["SAMPLE-0002"]);
  });

  it("いまのデータにない問題_どちらにも入らない", async () => {
    const { deps } = stack();
    deps.questions = async () => [
      { questionId: "SAMPLE-0002", questionType: "single" as const, correctAnswers: ["A"] },
    ];
    await handlePostResult(post(attempt(minute(1)), "a"), deps);
    expect(await review(deps, "a")).toEqual(["SAMPLE-0002"]);
  });

  it("利用者が違う_互いの復習プールは混ざらない", async () => {
    const { deps } = stack();
    deps.questions = questions;
    await handlePostResult(post(attempt(minute(1)), "a"), deps);
    expect(await review(deps, "b")).toEqual([]);
  });
});
