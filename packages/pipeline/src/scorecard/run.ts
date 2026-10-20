import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Config } from "../config.ts";
import { QuestionsFileSchema } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { prepareExam } from "../shared/exam.ts";
import { PASSING, resolveProfile } from "./profiles.ts";
import {
  batchPasses,
  type QuestionScore,
  questionPasses,
  type ScoreInput,
  scoreBatch,
  scoreQuestion,
} from "./score.ts";

/**
 * score コマンド: 公開している問題データを、書き方の点数票で採点する(docs/exam-style/scorecard.md)。
 * 読むだけで、何も書かない。モデルは呼ばない。重さは「警告」で、不合格でも終了コードは 0 にする。
 * 出力は、問題の ID・項目の ID・点数・割合だけで、設問文や選択肢の本文は出さない。
 */

export interface ScoreOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  output: Output;
}

/** 低得点の問題として挙げる件数 */
const LOWEST = 10;

const round1 = (n: number) => (Math.round(n * 10) / 10).toString();
const percent = (n: number) => `${Math.round(n * 100)}%`;

export function runScore({ config, rootDir, examCode, output }: ScoreOptions): ExitCode {
  const exam = prepareExam({ config, rootDir, examCode, output });
  if (!exam.ok) return exam.exit;
  const profile = resolveProfile(examCode);
  if (profile === null) {
    report(output, "入力の誤り", "点数票の帯がない資格");
    return EXIT.inputError;
  }
  const file = resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`);
  if (!existsSync(file)) {
    report(output, "入力の誤り", "問題データがない");
    return EXIT.inputError;
  }
  const parsed = QuestionsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) {
    report(output, "問題データの誤り", relative(rootDir, file));
    return EXIT.inputError;
  }
  const inputs: ScoreInput[] = parsed.data.questions.flatMap((q) =>
    q.questionType === "free-text"
      ? []
      : [
          {
            id: q.questionId,
            type: q.questionType,
            stem: q.questionText,
            choices: q.choices.map((c) => c.text),
            correct: q.correctAnswers.map((a) => q.choices.findIndex((c) => c.key === a)),
          },
        ],
  );
  if (inputs.length === 0) {
    report(output, "入力の誤り", "選択式の問題がない");
    return EXIT.inputError;
  }

  const scores: QuestionScore[] = inputs.map((q) => scoreQuestion(q, profile));
  const passed = scores.filter(questionPasses).length;
  const mean = scores.reduce((a, s) => a + s.total, 0) / scores.length;
  report(output, "点数票", `${examCode} 選択式 ${scores.length} 問`);
  report(
    output,
    "点数票",
    `問題ごと(${PASSING.question} 点で合格): 平均 ${round1(mean)} 点、合格 ${passed} 問(${percent(passed / scores.length)})`,
  );
  const lostCount = new Map<string, number>();
  for (const s of scores) for (const item of s.lost) lostCount.set(item, (lostCount.get(item) ?? 0) + 1);
  const lostLine = [...lostCount]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
    .map(([item, n]) => `${item}=${n}`);
  report(output, "点数票", `減点のあった項目(問数): ${lostLine.length === 0 ? "なし" : lostLine.join(" ")}`);
  const lowest = [...scores].sort((a, b) => a.total - b.total || (a.id < b.id ? -1 : 1)).slice(0, LOWEST);
  report(output, "点数票", `低い順: ${lowest.map((s) => `${s.id}=${s.total}`).join(" ")}`);

  if (inputs.length < PASSING.batchMinQuestions) {
    report(output, "点数票", `束: ${PASSING.batchMinQuestions} 問未満なので採点しない`);
    return EXIT.ok;
  }
  const batch = scoreBatch(inputs, profile);
  report(
    output,
    "点数票",
    `束(${PASSING.batch} 点で合格): ${batch.total} 点(${batchPasses(batch) ? "合格" : "不合格"}) ${Object.entries(
      batch.items,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  );
  const m = batch.metrics;
  report(
    output,
    "点数票",
    `束の測定値: 複数選択 ${percent(m.multiShare)}、状況つき ${percent(m.situationShare)}、設問文の中央値 ${round1(m.stemMedian)} 字(p90 ${m.stemP90} 字)、選択肢の形 名称 ${percent(m.nameShare)} / 語句 ${percent(m.phraseShare)} / 文 ${percent(m.sentenceShare)}、書き出しの最大の偏り ${percent(m.openerTopShare)}`,
  );
  return EXIT.ok;
}
