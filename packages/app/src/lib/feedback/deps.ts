import { guardDeps } from "@/lib/auth/deps.ts";
import { findPublishedExam, loadQuestions } from "@/lib/exam-data.ts";
import { listReleases } from "@/lib/release-notes.ts";
import { REPOSITORY_URL } from "@/lib/site.ts";
import { createGithubIssueCreator, type IssueCreator, issueTargetOf, readGithubApp } from "./github-app.ts";
import type { FeedbackDeps } from "./handlers.ts";
import { getFeedbackRepository } from "./repository.ts";

// インストールのトークンを使い回すため、起票の関数はプロセスで 1 つにする(設定が変わったら作り直す)
let creator: { key: string; create: IssueCreator } | undefined;

function issueCreator(): IssueCreator | null {
  const settings = readGithubApp(process.env);
  if (!settings) return null;
  const key = `${settings.appId}/${settings.installationId}/${settings.privateKeyParameter}`;
  if (creator?.key !== key) {
    creator = { key, create: createGithubIssueCreator({ settings, target: issueTargetOf(REPOSITORY_URL) }) };
  }
  return creator.create;
}

export function feedbackDeps(): FeedbackDeps {
  return {
    auth: guardDeps(),
    repository: getFeedbackRepository(),
    createIssue: issueCreator(),
    questionExists: async (examCode, questionId) => {
      const exam = findPublishedExam(examCode);
      if (!exam) return false;
      return (await loadQuestions(exam)).some((question) => question.questionId === questionId);
    },
    appVersion: listReleases()[0]?.version ?? "不明",
  };
}
