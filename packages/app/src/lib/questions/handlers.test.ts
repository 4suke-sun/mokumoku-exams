import { describe, expect, it } from "vitest";
import type { AuthProvider } from "@/lib/auth/types.ts";
import type { TokenVerifier } from "@/lib/auth/verify.ts";
import type { Question } from "@/lib/types.ts";
import { handleGetQuestions, MAX_QUESTIONS_PER_REQUEST, type QuestionsDeps } from "./handlers.ts";

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

const question = (n: number) =>
  ({
    questionId: `SAMPLE-000${n}`,
    examCode: "EX-SMP-XX",
    domain: "domain1",
    questionType: "single",
    questionText: `問題 ${n}`,
    choices: [
      { key: "A", text: "a" },
      { key: "B", text: "b" },
    ],
    correctAnswers: ["A"],
    explanation: "解説",
  }) as Question;
const pool = [question(1), question(2), question(3)];

const deps = (questions: QuestionsDeps["questions"] = async (code) => (code === "EX-SMP-XX" ? pool : null)) => ({
  auth: { verifier, provider: noRefresh, secure: false },
  questions,
});

const post = (body: unknown, cookie = "mokumoku_id=token-user-a") =>
  new Request("http://localhost/api/questions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

describe("問題の API", () => {
  it("ログインしている_指定した問題だけを指定の順で返し_いまのデータにない問題は入れない", async () => {
    const response = await handleGetQuestions(
      post({ examCode: "EX-SMP-XX", questionIds: ["SAMPLE-0003", "SAMPLE-0001", "SAMPLE-0009", "SAMPLE-0003"] }),
      deps(),
    );
    expect(response.status).toBe(200);
    const { questions } = (await response.json()) as { questions: Question[] };
    expect(questions.map((q) => q.questionId)).toEqual(["SAMPLE-0003", "SAMPLE-0001"]);
  });

  it("未ログイン_401 で断り_問題を返さない", async () => {
    const response = await handleGetQuestions(
      post({ examCode: "EX-SMP-XX", questionIds: ["SAMPLE-0001"] }, ""),
      deps(),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("SAMPLE-0001");
  });

  it("公開中でない資格と形の違う ID と多すぎる ID_400 で断る", async () => {
    expect(
      (await handleGetQuestions(post({ examCode: "EX-ZZZ-XX", questionIds: ["SAMPLE-0001"] }), deps())).status,
    ).toBe(400);
    expect((await handleGetQuestions(post({ examCode: "EX-SMP-XX", questionIds: ["x"] }), deps())).status).toBe(400);
    const many = Array.from({ length: MAX_QUESTIONS_PER_REQUEST + 1 }, () => "SAMPLE-0001");
    expect((await handleGetQuestions(post({ examCode: "EX-SMP-XX", questionIds: many }), deps())).status).toBe(400);
  });
});
