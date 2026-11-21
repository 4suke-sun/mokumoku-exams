import { acceptBody, fail, unavailable } from "@/lib/api/endpoint.ts";
import { logApiFailure } from "@/lib/api/log.ts";
import type { GuardDeps } from "@/lib/auth/guard.ts";
import { json } from "@/lib/auth/handlers.ts";
import type { IssueCreator } from "./github-app.ts";
import { buildFeedbackIssue } from "./issue.ts";
import { type FeedbackRepository, tokyoDay } from "./repository.ts";
import { DAILY_FEEDBACK_LIMIT, FeedbackRequestSchema, MAX_FEEDBACK_BODY_BYTES } from "./schema.ts";

export type FeedbackDeps = {
  auth: GuardDeps;
  repository: FeedbackRepository;
  /** App の設定がなければ null(GitHub の API を呼ばず、503) */
  createIssue: IssueCreator | null;
  /** 公開中の問題に、その資格コードと問題 ID があるか */
  questionExists: (examCode: string, questionId: string) => Promise<boolean>;
  /** 公開中の資格に、その資格コードがあるか(試験についてのお問い合わせ) */
  examExists: (examCode: string) => Promise<boolean>;
  /** Issue の本文に書く、アプリの版 */
  appVersion: string;
  now?: () => number;
};

/**
 * 送信フォームの内容を、Issue として起票する(docs/app/specs/feedback.md)。ログインした利用者だけが送れる。
 * 回数を先に 1 増やしてから起票し、起票に失敗したら戻す。応答に、Issue の番号や URL は入れない。
 * 利用者の識別子(`sub`)は、回数を数えるためだけに使い、Issue には渡さない。
 */
export async function handleFeedback(request: Request, deps: FeedbackDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_FEEDBACK_BODY_BYTES,
    body: FeedbackRequestSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;

  try {
    if (body.form === "question" && !(await deps.questionExists(body.examCode, body.questionId))) {
      return fail("bad-request", 400, auth.setCookies);
    }
    if (body.form === "contact" && body.examCode !== undefined && !(await deps.examExists(body.examCode))) {
      return fail("bad-request", 400, auth.setCookies);
    }
  } catch (error) {
    return unavailable(request, error, auth.setCookies);
  }
  if (!deps.createIssue) return fail("unavailable", 503, auth.setCookies);

  const day = tokyoDay((deps.now ?? Date.now)());
  let consumed: boolean;
  try {
    consumed = await deps.repository.consume(auth.user.sub, day, DAILY_FEEDBACK_LIMIT);
  } catch (error) {
    return unavailable(request, error, auth.setCookies);
  }
  if (!consumed) return fail("limit-exceeded", 429, auth.setCookies);

  try {
    await deps.createIssue(buildFeedbackIssue(body, deps.appVersion));
  } catch (error) {
    // 回数を戻せなくても、利用者への応答は同じ(戻せなかった 1 件は、その日のうちだけ数に残る)
    await deps.repository.refund(auth.user.sub, day).catch((refundError: unknown) => {
      logApiFailure(request, 503, refundError);
    });
    return unavailable(request, error, auth.setCookies);
  }
  return json({ status: "sent" }, 201, auth.setCookies);
}
