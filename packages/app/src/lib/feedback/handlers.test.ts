import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import { GithubUnavailableError, type IssueCreator } from "./github-app.ts";
import { type FeedbackDeps, handleFeedback } from "./handlers.ts";
import type { FeedbackIssue } from "./issue.ts";
import { createMemoryFeedbackRepository, type FeedbackRepository } from "./repository.ts";
import { DAILY_FEEDBACK_LIMIT } from "./schema.ts";

const ORIGIN = "http://localhost";

const verifier: TokenVerifier = {
  async verifyIdToken(token) {
    if (!token.startsWith("token-")) return null;
    return { sub: token.slice("token-".length), groups: [] };
  },
};
const noRefresh = {
  async refresh() {
    throw new Error("unavailable");
  },
} as unknown as AuthProvider;

function recordingCreator() {
  const issues: FeedbackIssue[] = [];
  const create: IssueCreator = async (issue) => {
    issues.push(issue);
  };
  return { issues, create };
}

function deps(overrides: Partial<FeedbackDeps> = {}): FeedbackDeps {
  return {
    auth: { verifier, provider: noRefresh, secure: false },
    repository: createMemoryFeedbackRepository(),
    createIssue: recordingCreator().create,
    questionExists: async (examCode, questionId) => examCode === "EX-SMP-XX" && questionId === "SAMPLE-0001",
    appVersion: "v0.84.0",
    now: () => Date.parse("2026-11-15T00:00:00Z"),
    ...overrides,
  };
}

function post(body: unknown, options: { sub?: string | null; site?: string; contentType?: string } = {}) {
  const sub = options.sub === undefined ? "user-a" : options.sub;
  return new Request(`${ORIGIN}/api/feedback`, {
    method: "POST",
    headers: {
      "content-type": options.contentType ?? "application/json",
      ...(options.site ? { "sec-fetch-site": options.site } : {}),
      ...(sub ? { cookie: `mokumoku_id=token-${sub}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const contact = { form: "contact", category: "bug", text: "動かない" };
const report = { form: "question", category: "answer", text: "", examCode: "EX-SMP-XX", questionId: "SAMPLE-0001" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleFeedback", () => {
  it("お問い合わせを送る_201 を返し_Issue を 1 件起票し_応答に Issue の番号を入れない", async () => {
    const creator = recordingCreator();
    const response = await handleFeedback(post(contact), deps({ createIssue: creator.create }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "sent" });
    expect(creator.issues).toHaveLength(1);
    expect(creator.issues[0]?.title).toBe("お問い合わせ: 不具合");
  });

  it("起票する Issue_利用者の識別子を題にも本文にも入れない", async () => {
    const creator = recordingCreator();
    await handleFeedback(post(contact, { sub: "user-secret-sub" }), deps({ createIssue: creator.create }));
    const issue = creator.issues[0];
    expect(`${issue?.title}${issue?.body}`).not.toContain("user-secret-sub");
  });

  it("問題の誤りの報告で公開中の問題を指す_起票する", async () => {
    const creator = recordingCreator();
    const response = await handleFeedback(post(report), deps({ createIssue: creator.create }));
    expect(response.status).toBe(201);
    expect(creator.issues[0]?.labels).toEqual(["user", "data"]);
  });

  it("存在しない問題を指す_400 で断り_回数を増やさない", async () => {
    const repository = createMemoryFeedbackRepository();
    const consume = vi.spyOn(repository, "consume");
    const response = await handleFeedback(post({ ...report, questionId: "SAMPLE-9999" }), deps({ repository }));
    expect(response.status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
  });

  it("未ログイン_401 で断る", async () => {
    expect((await handleFeedback(post(contact, { sub: null }), deps())).status).toBe(401);
  });

  it("本文に未知の項目や利用者の識別子がある_400 で断る", async () => {
    for (const key of ["sub", "userId", "email", "PK"]) {
      expect((await handleFeedback(post({ ...contact, [key]: "x" }), deps())).status, key).toBe(400);
    }
  });

  it("お問い合わせの内容が空白だけ_または上限を超える_400 で断る", async () => {
    expect((await handleFeedback(post({ ...contact, text: "   " }), deps())).status).toBe(400);
    expect((await handleFeedback(post({ ...contact, text: "あ".repeat(2001) }), deps())).status).toBe(400);
    expect((await handleFeedback(post({ ...contact, text: ` ${"あ".repeat(2000)} ` }), deps())).status).toBe(201);
  });

  it("JSON でない形式_または別サイトからの送信_断る", async () => {
    expect((await handleFeedback(post(contact, { contentType: "text/plain" }), deps())).status).toBe(415);
    expect((await handleFeedback(post(contact, { site: "cross-site" }), deps())).status).toBe(403);
  });

  it("その日の上限まで送った_次は 429 で断り_起票しない", async () => {
    const creator = recordingCreator();
    const d = deps({ createIssue: creator.create });
    for (let i = 0; i < DAILY_FEEDBACK_LIMIT; i++) expect((await handleFeedback(post(contact), d)).status).toBe(201);
    expect((await handleFeedback(post(contact), d)).status).toBe(429);
    expect(creator.issues).toHaveLength(DAILY_FEEDBACK_LIMIT);
  });

  it("App の設定がない_GitHub を呼ばず 503 を返し_回数を増やさない", async () => {
    const repository = createMemoryFeedbackRepository();
    const consume = vi.spyOn(repository, "consume");
    const response = await handleFeedback(post(contact), deps({ createIssue: null, repository }));
    expect(response.status).toBe(503);
    expect(consume).not.toHaveBeenCalled();
  });

  it("起票が失敗する_503 を返し_増やした 1 を戻し_原因を応答とログに出さない", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const repository: FeedbackRepository = createMemoryFeedbackRepository();
    const refund = vi.spyOn(repository, "refund");
    const createIssue: IssueCreator = async () => {
      throw new GithubUnavailableError();
    };
    const response = await handleFeedback(post(contact), deps({ createIssue, repository }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect(refund).toHaveBeenCalledWith("user-a", "2026-11-15");
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toContain("GithubUnavailableError");
  });

  it("起票が失敗し続ける_上限の回数を失敗で使い切らない", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const createIssue: IssueCreator = async () => {
      throw new GithubUnavailableError();
    };
    const d = deps({ createIssue });
    for (let i = 0; i < DAILY_FEEDBACK_LIMIT + 1; i++)
      expect((await handleFeedback(post(contact), d)).status).toBe(503);
  });
});
