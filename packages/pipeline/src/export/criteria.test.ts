import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChoiceDraft } from "../draft/schema.ts";
import type { DraftRecord } from "../draft/store.ts";
import { resolveProfile } from "../scorecard/profiles.ts";
import { questionPasses, scoreQuestion } from "../scorecard/score.ts";
import { criteriaAccepted } from "./criteria.ts";

const CODE = "AWS-DVA-C02";
const repoRoot = resolve(import.meta.dirname, "../../../..");

type Published = {
  questionText: string;
  questionType: string;
  choices?: { key: string; text: string }[];
  correctAnswers?: string[];
};

/** 公開中の問題から、点数票に合格する選択式の問題を 1 つ、下書きの形で取る */
function passingDraft(): ChoiceDraft {
  const profile = resolveProfile(CODE);
  if (profile === null) throw new Error("profile");
  const data = JSON.parse(readFileSync(resolve(repoRoot, "data/questions.aws-dva-c02.json"), "utf8")) as {
    questions: Published[];
  };
  for (const q of data.questions) {
    if (q.questionType === "free-text" || q.choices === undefined || q.correctAnswers === undefined) continue;
    const choices = q.choices;
    const score = scoreQuestion(
      {
        id: "x",
        type: q.questionType as "single" | "multiple",
        stem: q.questionText,
        choices: choices.map((c) => c.text),
        correct: q.correctAnswers.map((a) => choices.findIndex((c) => c.key === a)),
      },
      profile,
    );
    if (questionPasses(score)) {
      return {
        questionType: q.questionType as "single" | "multiple",
        questionText: q.questionText,
        choices,
        correctAnswers: q.correctAnswers,
        explanation: "架空の解説",
        factIds: ["f-000000000001"],
      };
    }
  }
  throw new Error("合格する問題がない");
}

function record(id: string, draft: ChoiceDraft, verdict: "pass" | "hold" = "pass"): DraftRecord {
  return {
    id,
    planItemId: "p-000000000001",
    domain: "domain1",
    difficulty: "medium",
    status: "passed",
    reasons: [],
    warnings: [],
    draft,
    verification: { verdict, reasons: [], findings: [], checks: {} },
  };
}

describe("基準で承認を省く下書きの選び方", () => {
  const good = passingDraft();

  it("検証が合格で点数票に合格する下書き_選ぶ。検証が保留の下書きは選ばない", () => {
    const accepted = criteriaAccepted({
      drafts: [record("d-000000000001", good), record("d-000000000002", good, "hold")],
      examCode: CODE,
      targets: undefined,
      services: [],
      publishedTexts: [],
    });
    expect([...accepted]).toEqual(["d-000000000001"]);
  });

  it("点数票に合格しない下書き_選ばない", () => {
    const poor: ChoiceDraft = { ...good, questionText: "短い設問" };
    const accepted = criteriaAccepted({
      drafts: [record("d-000000000001", poor)],
      examCode: CODE,
      targets: undefined,
      services: [],
      publishedTexts: [],
    });
    expect(accepted.size).toBe(0);
  });

  it("対象サービスの目標があり一覧がない_どの下書きも選ばない(人の確認に回す)", () => {
    const accepted = criteriaAccepted({
      drafts: [record("d-000000000001", good)],
      examCode: CODE,
      targets: { minPerService: 1, maxShare: 0.5 },
      services: [],
      publishedTexts: [],
    });
    expect(accepted.size).toBe(0);
  });

  it("出るサービスがすべて割合の上限を超える下書き_選ばない。上限を超えないサービスも出れば選ぶ", () => {
    const withService = (name: string): ChoiceDraft => ({
      ...good,
      questionText: `${name} を使う。${good.questionText}`,
    });
    const services = ["AWS Lambda", "Amazon DynamoDB"];
    const accepted = criteriaAccepted({
      drafts: [
        record("d-000000000001", withService("Lambda")),
        record("d-000000000002", withService("DynamoDB と Lambda")),
      ],
      examCode: CODE,
      targets: { minPerService: 0, maxShare: 0.5 },
      services,
      publishedTexts: ["Lambda", "Lambda", "Lambda"],
    });
    expect([...accepted]).toEqual(["d-000000000002"]);
  });

  it("点数票の帯のない資格_どの下書きも選ばない", () => {
    const accepted = criteriaAccepted({
      drafts: [record("d-000000000001", good)],
      examCode: "EX-SMP-XX",
      targets: undefined,
      services: [],
      publishedTexts: [],
    });
    expect(accepted.size).toBe(0);
  });
});
