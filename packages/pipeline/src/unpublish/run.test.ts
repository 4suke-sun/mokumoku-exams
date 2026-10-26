import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { baseConfig, runMain } from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { readCriteria } from "../judge/criteria.ts";
import { contentHash, inputFromQuestion } from "../judge/input.ts";
import type { JudgeEntry, JudgeVerdict } from "../judge/schema.ts";
import { EXAM, goodQuestion, type TestQuestion } from "../judge/test-helpers.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { installAgentDefinitions } from "../shared/test-helpers.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const JUDGE_DIR = join(baseConfig.workDir, "judge", EXAM.toLowerCase());

/** 正解の位置をずらした問題(正解の位置の偏りの検査に触れないように) */
function question(n: number): TestQuestion {
  const base = goodQuestion(n);
  const shift = n % 4;
  const choices = base.choices.map((c, i) => ({ ...c, text: base.choices[(i + shift) % 4]?.text ?? c.text }));
  const answer = choices.find((c) => c.text === base.choices[0]?.text)?.key ?? "A";
  return { ...base, choices, correctAnswers: [answer] };
}

interface Setup {
  questions?: TestQuestion[];
  /** 資格マスタの本番の出題数(既定は 3) */
  officialQuestionCount?: number;
  retiredQuestionIds?: string[];
}

/** 作業ディレクトリ(一時)。AIB の資格マスタ(出題数だけ小さくしたもの)、判定の基準の文書、エージェントの定義、公開の問題を置く */
function setupRoot({
  questions = [1, 2, 3, 4, 5, 6].map(question),
  officialQuestionCount = 3,
  retiredQuestionIds,
}: Setup = {}) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-unpublish-"));
  mkdirSync(join(root, "data"));
  const exams = JSON.parse(readFileSync(join(repoRoot, "data/exams.json"), "utf8")) as {
    exams: { examCode: string; officialQuestionCount?: number; retiredQuestionIds?: string[] }[];
  };
  exams.exams = exams.exams
    .filter((e) => e.examCode === EXAM)
    .map((e) =>
      e.examCode === EXAM ? { ...e, officialQuestionCount, ...(retiredQuestionIds ? { retiredQuestionIds } : {}) } : e,
    );
  writeFileSync(join(root, "data/exams.json"), JSON.stringify(exams));
  installAgentDefinitions(root);
  mkdirSync(join(root, "docs/exam-style"), { recursive: true });
  cpSync(join(repoRoot, "docs/exam-style/aws-aib.md"), join(root, "docs/exam-style/aws-aib.md"));
  writeQuestions(root, questions);
  return root;
}

const writeQuestions = (root: string, questions: readonly TestQuestion[]) =>
  writeFileSync(join(root, "data/questions.aws-aib-c01.json"), JSON.stringify({ examCode: EXAM, questions }));

interface UnpublishedJson {
  examCode: string;
  entries: { verdict: string; reasons: string[]; question: { questionId: string } }[];
}
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

/** 判定の結果を書く。verdicts は問題の ID → 判定と理由コード */
function writeResults(
  root: string,
  questions: readonly TestQuestion[],
  verdicts: Record<string, { verdict: JudgeVerdict; reasons?: string[] }>,
  overrides: Partial<JudgeEntry> = {},
) {
  const criteria = readCriteria(root, EXAM);
  const entries = questions.flatMap((q) => {
    const v = verdicts[q.questionId];
    const input = inputFromQuestion(q);
    if (v === undefined || input === null || criteria === null) return [];
    const reasons =
      v.verdict === "publish"
        ? []
        : (v.reasons ?? [v.verdict === "unpublish" ? "judge:not-unique" : "judge:choices-weak"]);
    return [
      {
        questionId: q.questionId,
        contentHash: contentHash(input),
        criteriaHash: criteria.hash,
        verdict: v.verdict,
        reasons,
        findings: reasons.map((r) => ({ code: r.replace("judge:", ""), where: "questionText" })),
        machine: { total: 100, lost: [], candidate: false },
        agent: readAgentStamp(root, "question-judge"),
        ...overrides,
      },
    ];
  });
  mkdirSync(join(root, JUDGE_DIR), { recursive: true });
  writeFileSync(join(root, JUDGE_DIR, "results.json"), JSON.stringify({ examCode: EXAM, entries }));
}

const publishedIds = (root: string) =>
  (readJson(join(root, "data/questions.aws-aib-c01.json")) as { questions: { questionId: string }[] }).questions.map(
    (q) => q.questionId,
  );
const unpublishedFile = (root: string) => readJson(join(root, "data/unpublished.aws-aib-c01.json")) as UnpublishedJson;

describe("unpublish", () => {
  const all = [1, 2, 3, 4, 5, 6].map(question);

  it("rewritable と unpublish の問題_非公開のファイルへ移し_判定と理由を添え_公開のファイルから取り除く", async () => {
    const root = setupRoot();
    writeResults(root, all, {
      "AIB-0002": { verdict: "rewritable", reasons: ["judge:choices-weak", "judge:type-mismatch"] },
      "AIB-0005": { verdict: "unpublish", reasons: ["judge:not-unique"] },
      "AIB-0001": { verdict: "publish" },
    });
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(publishedIds(root)).toEqual(["AIB-0001", "AIB-0003", "AIB-0004", "AIB-0006"]);
    const file = unpublishedFile(root);
    expect(file.examCode).toBe(EXAM);
    expect(file.entries.map((e) => e.question.questionId)).toEqual(["AIB-0002", "AIB-0005"]);
    expect(file.entries[0]).toMatchObject({
      verdict: "rewritable",
      reasons: ["judge:choices-weak", "judge:type-mismatch"],
    });
    expect(file.entries[1]).toMatchObject({ verdict: "unpublish", reasons: ["judge:not-unique"] });
    expect(file.entries[0]?.question).toEqual(all[1]);
    expect(r.out).toContain("移す 2 問");
    expect(r.out).toContain("移す問題の理由コード: judge:choices-weak=1 judge:not-unique=1 judge:type-mismatch=1");
    expect(r.out).toContain("公開の選択式 6 問 → 4 問(本番モードの出題数 3 問)");
    expect(r.out).toContain("判定の件数の差: 前回の記録がない");
  });

  it("出力と記録_問題の本文を含まない", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0002": { verdict: "rewritable" } });
    const r = await runMain(root, ["unpublish", EXAM]);
    const record = readFileSync(join(root, JUDGE_DIR, "unpublish-report.json"), "utf8");
    for (const text of [r.out + r.err, record]) {
      expect(text).not.toContain("最初に実施すべきことはどれですか");
      expect(text).not.toContain("運用方針");
    }
    expect(JSON.parse(record).moved.ids).toEqual(["AIB-0002"]);
  });

  it("移したあと_データの検査(公開と非公開の ID の重なりなし)を通る", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0003": { verdict: "rewritable" } });
    await runMain(root, ["unpublish", EXAM]);
    const exams = readJson(join(root, "data/exams.json"));
    const { validateDataSet } = await import("../contract.ts");
    const errors = validateDataSet(
      exams,
      [{ name: "questions.aws-aib-c01.json", data: readJson(join(root, "data/questions.aws-aib-c01.json")) }],
      undefined,
      [],
      [{ name: "unpublished.aws-aib-c01.json", data: unpublishedFile(root) }],
    );
    expect(errors).toEqual([]);
  });

  it("公開の選択式が出題の下限を下回る移し方_何も書かずに検査の失敗で止める", async () => {
    const root = setupRoot({ officialQuestionCount: 5 });
    writeResults(root, all, {
      "AIB-0001": { verdict: "rewritable" },
      "AIB-0002": { verdict: "rewritable" },
    });
    const before = readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8");
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("出題の下限");
    expect(r.err).toContain("移すと公開の選択式が 1 問足りない");
    expect(readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, "data/unpublished.aws-aib-c01.json"))).toBe(false);
  });

  it("出題の下限ちょうど_移せる", async () => {
    const root = setupRoot({ officialQuestionCount: 5 });
    writeResults(root, all, { "AIB-0001": { verdict: "rewritable" } });
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(publishedIds(root)).toHaveLength(5);
  });

  it("判定のあとに内容が変わった問題と、判定の基準が変わったあとの判定_移さず、古い判定として数える", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0002": { verdict: "rewritable" }, "AIB-0003": { verdict: "rewritable" } });
    writeQuestions(root, [
      all[0],
      { ...(all[1] as TestQuestion), explanation: "## 正解の決め手\n書き直しました。" },
      ...all.slice(2),
    ] as TestQuestion[]);
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("移す 1 問、判定が古くて移さない 1 問");
    expect(publishedIds(root)).toContain("AIB-0002");
    expect(publishedIds(root)).not.toContain("AIB-0003");

    const stale = setupRoot();
    writeResults(stale, all, { "AIB-0002": { verdict: "rewritable" } }, { criteriaHash: "b".repeat(64) });
    const r2 = await runMain(stale, ["unpublish", EXAM]);
    expect(r2.out).toContain("移す 0 問、判定が古くて移さない 1 問");
    expect(existsSync(join(stale, "data/unpublished.aws-aib-c01.json"))).toBe(false);
  });

  it("判定のあとに判定役の定義が変わった_古い判定として移さない", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0002": { verdict: "rewritable" } });
    const def = join(root, ".claude/agents/question-judge.md");
    writeFileSync(def, `${readFileSync(def, "utf8")}\n- 指示を足した。\n`);
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("移す 0 問、判定が古くて移さない 1 問");
    expect(existsSync(join(root, "data/unpublished.aws-aib-c01.json"))).toBe(false);
  });

  it("カリキュラムの単元か要約カードが参照している問題_移さず、参照元を報告する", async () => {
    const root = setupRoot();
    writeFileSync(
      join(root, "data/curriculum.aws-aib-c01.json"),
      JSON.stringify({ units: [{ questionIds: ["AIB-0002"] }] }),
    );
    writeFileSync(
      join(root, "data/summary.aws-aib-c01.json"),
      JSON.stringify({ cards: [{ questionId: "AIB-0002" }, { questionId: "AIB-0003" }] }),
    );
    writeResults(root, all, {
      "AIB-0002": { verdict: "rewritable" },
      "AIB-0003": { verdict: "unpublish" },
      "AIB-0004": { verdict: "rewritable" },
    });
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("移す 1 問");
    expect(r.out).toContain("参照があって移さない 2 問");
    expect(r.out).toContain("非公開に移さない: AIB-0002 参照 curriculum,summary");
    expect(r.out).toContain("非公開に移さない: AIB-0003 参照 summary");
    expect(publishedIds(root)).toEqual(["AIB-0001", "AIB-0002", "AIB-0003", "AIB-0005", "AIB-0006"]);
  });

  it("カリキュラムの段階の確認問題だけが参照している問題_移さない", async () => {
    const root = setupRoot();
    writeFileSync(
      join(root, "data/curriculum.aws-aib-c01.json"),
      JSON.stringify({ units: [{ questionIds: ["AIB-0001"], stages: [{ order: 1, questionIds: ["AIB-0002"] }] }] }),
    );
    writeResults(root, all, { "AIB-0002": { verdict: "rewritable" }, "AIB-0003": { verdict: "rewritable" } });
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("非公開に移さない: AIB-0002 参照 curriculum");
    expect(publishedIds(root)).toContain("AIB-0002");
    expect(publishedIds(root)).not.toContain("AIB-0003");
  });

  it("すでに非公開のファイルがある_既存の件を残し_ID の順に合わせる。再実行しても重ねない", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0005": { verdict: "unpublish" } });
    await runMain(root, ["unpublish", EXAM]);
    writeResults(
      root,
      all.filter((q) => q.questionId !== "AIB-0005"),
      { "AIB-0002": { verdict: "rewritable" } },
    );
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const ids = unpublishedFile(root).entries.map((e) => e.question.questionId);
    expect(ids).toEqual(["AIB-0002", "AIB-0005"]);
    const again = await runMain(root, ["unpublish", EXAM]);
    expect(again.code).toBe(EXIT.ok);
    expect(unpublishedFile(root).entries).toHaveLength(2);
  });

  it("前回の移動のときの判定の件数がある_理由コードと判定の件数の差を出す", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0001": { verdict: "rewritable", reasons: ["judge:choices-weak"] } });
    await runMain(root, ["unpublish", EXAM]);
    writeResults(root, all.slice(1), {
      "AIB-0002": { verdict: "rewritable", reasons: ["judge:choices-weak"] },
      "AIB-0003": { verdict: "rewritable", reasons: ["judge:situation-unnatural"] },
    });
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.out).toContain(
      "判定の件数の差(前回の移動との差): publish 0 rewritable +1 unpublish 0、理由コード judge:situation-unnatural +1",
    );
  });

  it("dry-run_何も書かない", async () => {
    const root = setupRoot();
    writeResults(root, all, { "AIB-0002": { verdict: "rewritable" } });
    const before = readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8");
    const r = await runMain(root, ["unpublish", EXAM, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("書き込みをしない(dry-run)");
    expect(readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, "data/unpublished.aws-aib-c01.json"))).toBe(false);
    expect(existsSync(join(root, JUDGE_DIR, "unpublish-report.json"))).toBe(false);
  });

  it("移したあとのデータの検査に落ちる(退役した ID と重なる)_何も書かない", async () => {
    const root = setupRoot({ retiredQuestionIds: ["AIB-0002"] });
    writeResults(root, all, { "AIB-0002": { verdict: "rewritable" } });
    const before = readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8");
    const r = await runMain(root, ["unpublish", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("データの検査の失敗");
    expect(readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8")).toBe(before);
    expect(existsSync(join(root, "data/unpublished.aws-aib-c01.json"))).toBe(false);
  });

  it("入力がない_判定の結果・判定の基準・問題データ・資格コードがないときは入力の誤りで止まる", async () => {
    const noResults = setupRoot();
    expect((await runMain(noResults, ["unpublish", EXAM])).code).toBe(EXIT.inputError);
    const noCriteria = setupRoot();
    writeResults(noCriteria, all, { "AIB-0002": { verdict: "rewritable" } });
    writeFileSync(join(noCriteria, "docs/exam-style/aws-aib.md"), "# AIB\n");
    const r = await runMain(noCriteria, ["unpublish", EXAM]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("判定の基準がない");
    const noQuestions = setupRoot();
    rmSync(join(noQuestions, "data/questions.aws-aib-c01.json"));
    const r3 = await runMain(noQuestions, ["unpublish", EXAM]);
    expect(r3.code).toBe(EXIT.inputError);
    expect(r3.err).toContain("問題データがない");
    expect((await runMain(setupRoot(), ["unpublish"])).code).toBe(EXIT.inputError);
    expect((await runMain(setupRoot(), ["unpublish", "EX-SMP-XX"])).code).toBe(EXIT.inputError);
  });
});
