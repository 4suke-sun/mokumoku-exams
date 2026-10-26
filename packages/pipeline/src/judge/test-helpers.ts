import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { baseConfig } from "../draft/test-helpers.ts";
import { installAgentDefinitions } from "../shared/test-helpers.ts";
import { type JudgeRequest, JudgeRequestSchema } from "./request.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

export const EXAM = "AWS-AIB-C01";
export const JUDGE_DIR = join(baseConfig.workDir, "judge", EXAM.toLowerCase());

const INDUSTRIES = ["小売", "製造", "物流", "金融", "医療", "教育", "旅行", "出版"];

/** 点数票の AIB の帯を満たす設問文と選択肢(100 点)。n で言い回しを変える */
export function goodQuestion(n: number) {
  const industry = INDUSTRIES[n % INDUSTRIES.length] as string;
  return {
    questionId: `AIB-${String(n).padStart(4, "0")}`,
    examCode: EXAM,
    domain: "domain1",
    questionType: "single" as const,
    questionText: `ある${industry}企業は、問い合わせ対応に生成 AI を試験的に導入しました(その${n})。現場からは回答の品質にばらつきがあるという声が上がっています。経営層は、全社展開の前にリスクを管理する体制を整えたいと考えています。\n\nこれらの要件を満たすために、最初に実施すべきことはどれですか。`,
    choices: [
      { key: "A", text: "利用範囲と責任者を定めた運用方針を作成し、関係部門に周知する。" },
      { key: "B", text: "全部門に同時にツールを配布し、利用状況を数か月後に集計する。" },
      { key: "C", text: "回答の品質を評価する基準を作らず、現場の判断に任せて運用する。" },
      { key: "D", text: "導入を一時停止し、すべての部門から提案が出るまで待機する。" },
    ],
    correctAnswers: ["A"],
    explanation: "## 正解の決め手\n運用方針と責任者を先に定めると、リスクの管理を全社で進められます。",
  };
}

/** 点数票で 80 点に届かない問題(設問が短く、状況がない) */
export function weakQuestion(n: number) {
  return {
    questionId: `AIB-${String(n).padStart(4, "0")}`,
    examCode: EXAM,
    domain: "domain1",
    questionType: "single" as const,
    questionText: `AI の説明として正しいものはどれですか(その${n})。`,
    choices: [
      { key: "A", text: "推論をする仕組み。" },
      { key: "B", text: "計算機。" },
      { key: "C", text: "表計算。" },
      { key: "D", text: "印刷機。" },
    ],
    correctAnswers: ["A"],
    explanation: "AI は推論をする仕組みです。",
  };
}

export type TestQuestion = ReturnType<typeof goodQuestion>;

/** 判定の作業ディレクトリ(一時)。資格マスタ、エージェントの定義、判定の基準の文書、公開している問題を置く */
export function setupJudgeRoot(questions: readonly TestQuestion[]): string {
  const root = mkdtempSync(join(tmpdir(), "pipeline-judge-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  installAgentDefinitions(root);
  mkdirSync(join(root, "docs/exam-style"), { recursive: true });
  cpSync(join(repoRoot, "docs/exam-style/aws-aib.md"), join(root, "docs/exam-style/aws-aib.md"));
  writeQuestions(root, questions);
  return root;
}

export function writeQuestions(root: string, questions: readonly TestQuestion[]): void {
  writeFileSync(join(root, "data/questions.aws-aib-c01.json"), JSON.stringify({ examCode: EXAM, questions }));
}

export function readJudgeRequests(root: string, dir = JUDGE_DIR): JudgeRequest[] {
  const requests = join(root, dir, "requests");
  try {
    return readdirSync(requests)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JudgeRequestSchema.parse(JSON.parse(readFileSync(join(requests, f), "utf8"))));
  } catch {
    return [];
  }
}

/** 依頼の outputPath に、判定役の出力を書く */
export function writeJudgeOutput(root: string, request: JudgeRequest, output: object): void {
  const path = join(root, request.outputPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      examCode: request.examCode,
      requestKey: request.requestKey,
      questionId: request.questionId,
      ...output,
    }),
  );
}
