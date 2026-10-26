import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { unpairedWrongParagraphs } from "../contract.ts";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import { provenancePath, readProvenance } from "../draft/provenance.ts";
import type { ChoiceDraft } from "../draft/schema.ts";
import { readDrafts } from "../draft/store.ts";
import {
  baseConfig,
  draftFor,
  EXAM,
  markVerified,
  readChoiceRequests,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
} from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { allocateIds, references } from "./export.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

function existing(id: string, text: string, correct = "A") {
  return {
    questionId: id,
    examCode: EXAM,
    domain: "domain1",
    questionType: "single",
    questionText: text,
    choices: ["A", "B", "C", "D"].map((key) => ({ key, text: `${text} の選択肢 ${key}` })),
    correctAnswers: [correct],
    explanation: `${text} の解説です。正解の理由を説明します。`,
  };
}

/** 公開済みの問題(検査に通る形。本番モードの出題数を満たし、正解の記号を散らす) */
function publishedSet(count: number) {
  return Array.from({ length: count }, (_, i) =>
    existing(`AIB-${String(i + 1).padStart(4, "0")}`, `公開済みの架空の設問 ${i + 1} 番`, "ABCD"[i % 4] as string),
  );
}

/** 書き出しの検査に通る data/ を置く(公開中の資格のすべてに、問題のファイルがある) */
function exportRoot() {
  const root = setupDraftRoot({ questions: { examCode: EXAM, questions: publishedSet(90) } });
  cpSync(join(repoRoot, "data/questions.ex-smp-xx.json"), join(root, "data/questions.ex-smp-xx.json"));
  cpSync(join(repoRoot, "data/questions.aws-clf-c02.json"), join(root, "data/questions.aws-clf-c02.json"));
  cpSync(join(repoRoot, "data/questions.aws-dva-c02.json"), join(root, "data/questions.aws-dva-c02.json"));
  return root;
}

/** 資格マスタの、この資格に退役した ID を足す */
function retire(root: string, ids: string[]) {
  const path = join(root, "data/exams.json");
  const exams = JSON.parse(readFileSync(path, "utf8"));
  exams.exams = exams.exams.map((e: { examCode: string }) =>
    e.examCode === EXAM ? { ...e, retiredQuestionIds: ids } : e,
  );
  writeFileSync(path, JSON.stringify(exams));
}

/** 計画 → 依頼 → 取り込みまで進め、通過した下書きを 1 件作る。approve なら承認も記録する */
async function prepared(root: string, approve = true, verified = true, overrides: Partial<ChoiceDraft> = {}) {
  await runMain(root, ["plan", EXAM]);
  await runMain(root, ["draft", EXAM]);
  const request = readChoiceRequests(root).find((q) => q.kind === "single") as ReturnType<
    typeof readChoiceRequests
  >[number];
  writeOutput(root, request, [draftFor(request, overrides)]);
  await runMain(root, ["draft", EXAM, "--import"]);
  const id = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.id as string;
  if (verified) markVerified(root, id);
  if (approve) {
    writeDecisions(decisionsPath(join(root, baseConfig.decisionsDir), EXAM), {
      examCode: EXAM,
      decisions: [{ target: "draft", id, decision: "approve", reason: "reviewed" }],
    });
  }
  return id;
}

const questionsFile = (root: string) => join(root, "data/questions.aws-aib-c01.json");
const provenanceOf = (root: string) => readProvenance(provenancePath(join(root, baseConfig.provenanceDir), EXAM), EXAM);

describe("export", () => {
  it("承認した下書き_採番した ID と来歴の出典の URL で data/ に追加し、来歴に ID を書き戻す。再実行しても差分は増えない", async () => {
    const root = exportRoot();
    const draftId = await prepared(root);
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("書き出し: 追加 1 件、承認待ち 0 件");
    const data = JSON.parse(readFileSync(questionsFile(root), "utf8"));
    expect(data.questions).toHaveLength(91);
    const added = data.questions[90];
    expect(added.questionId).toBe("AIB-0091");
    expect(added.references).toEqual([{ url: "https://docs.aws.amazon.com/guide/service.html" }]);
    // 誤答の理由が、選択肢の解説になる
    expect(added.choices.find((c: { key: string }) => c.key === "A").explanation).toBeTruthy();
    // 既存の問題は変わらない
    expect(data.questions.slice(0, 90)).toEqual(publishedSet(90));
    expect(provenanceOf(root).entries.find((e) => e.draftId === draftId)?.questionId).toBe("AIB-0091");
    // 差分レポートは作業用の置き場にだけ書き、本文を含まない
    const report = readFileSync(join(root, baseConfig.workDir, "export/aws-aib-c01/report.md"), "utf8");
    expect(report).toContain("追加: 1 件");
    expect(report).not.toContain(added.questionText);
    // 同じ入力で再実行しても、差分は増えない
    const before = readFileSync(questionsFile(root), "utf8");
    const again = await runMain(root, ["export", EXAM]);
    expect(again.out).toContain("追加 0 件");
    expect(again.out).toContain("書き出し済み 1 件");
    expect(readFileSync(questionsFile(root), "utf8")).toBe(before);
  });

  it("承認のない下書き_書き出さず、承認待ちに数える", async () => {
    const root = exportRoot();
    await prepared(root, false);
    const before = readFileSync(questionsFile(root), "utf8");
    const r = await runMain(root, ["export", EXAM]);
    expect(r.out).toContain("追加 0 件、承認待ち 1 件");
    expect(readFileSync(questionsFile(root), "utf8")).toBe(before);
  });

  it("検証を通っていない下書き_承認があっても書き出さず、検証前に数える", async () => {
    const root = exportRoot();
    await prepared(root, true, false);
    const before = readFileSync(questionsFile(root), "utf8");
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("追加 0 件、承認待ち 0 件、検証前・検証で止まった 1 件");
    expect(readFileSync(questionsFile(root), "utf8")).toBe(before);
  });

  it("検証が保留の下書き_人が承認していれば書き出す(人の判断を優先する)", async () => {
    const root = exportRoot();
    const id = await prepared(root, true, false);
    markVerified(root, id, "hold");
    const r = await runMain(root, ["export", EXAM]);
    expect(r.out).toContain("追加 1 件");
  });

  it("退役した ID がある_退役した番号も使用済みとして、その次から採番する", async () => {
    const root = exportRoot();
    retire(root, ["AIB-0095"]);
    await prepared(root);
    await runMain(root, ["export", EXAM]);
    const data = JSON.parse(readFileSync(questionsFile(root), "utf8"));
    expect(data.questions.at(-1).questionId).toBe("AIB-0096");
  });

  it("非公開の問題がある_非公開の ID も使用済みとして、その次から採番する。書き出したあとの検査も、非公開のファイルを含めて通す", async () => {
    const root = exportRoot();
    const hidden = existing("AIB-0098", "非公開にした架空の設問");
    writeFileSync(
      join(root, "data/unpublished.aws-aib-c01.json"),
      JSON.stringify({
        examCode: EXAM,
        entries: [{ verdict: "rewritable", reasons: ["judge:choices-weak"], question: hidden }],
      }),
    );
    await prepared(root);
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const data = JSON.parse(readFileSync(questionsFile(root), "utf8"));
    expect(data.questions.at(-1).questionId).toBe("AIB-0099");
  });

  it("非公開の問題の ID が、公開の問題と重なる_書き出しを取り消す", async () => {
    const root = exportRoot();
    writeFileSync(
      join(root, "data/unpublished.aws-aib-c01.json"),
      JSON.stringify({
        examCode: EXAM,
        entries: [
          {
            verdict: "rewritable",
            reasons: ["judge:choices-weak"],
            question: existing("AIB-0001", "重なる ID の設問"),
          },
        ],
      }),
    );
    await prepared(root);
    const before = readFileSync(questionsFile(root), "utf8");
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(readFileSync(questionsFile(root), "utf8")).toBe(before);
  });

  it("書き出したあとのデータの検査に落ちる_書き出しを取り消し、来歴にも ID を書かない", async () => {
    const root = exportRoot();
    const draftId = await prepared(root);
    // 退役した ID を、既存の問題が使っている(書き出したあとのデータの検査が落ちる)
    retire(root, ["AIB-0001"]);
    const before = readFileSync(questionsFile(root), "utf8");
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("データの検査の失敗");
    expect(readFileSync(questionsFile(root), "utf8")).toBe(before);
    expect(provenanceOf(root).entries.find((e) => e.draftId === draftId)?.questionId).toBeUndefined();
  });

  it("問題のファイルがなく、書き出したあとのデータの検査に落ちる_作ったファイルを消す", async () => {
    const root = exportRoot();
    await prepared(root);
    rmSync(questionsFile(root));
    // 接頭辞の合わない退役した ID(書き出したあとのデータの検査が落ちる)
    retire(root, ["ZZZ-0001"]);
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(existsSync(questionsFile(root))).toBe(false);
  });

  it("来歴の検査に落ちる下書き(根拠の事実カードに再検証の印)_承認があっても書き出さない", async () => {
    const root = exportRoot();
    await prepared(root);
    const { ledgerPath, readLedger, writeLedger } = await import("../collect/ledger.ts");
    const path = ledgerPath(join(root, baseConfig.ledgerDir), EXAM);
    const facts = provenanceOf(root).entries[0]?.factIds ?? [];
    writeLedger(path, { ...readLedger(path, EXAM), recheck: { facts, questions: [] } });
    const r = await runMain(root, ["export", EXAM]);
    expect(r.out).toContain("承認待ち 0 件、検証前・検証で止まった 0 件、来歴の検査で止めた 1 件");
  });

  it("dry-run_件数だけを報告し、書き込まない", async () => {
    const root = exportRoot();
    await prepared(root);
    const before = readFileSync(questionsFile(root), "utf8");
    const r = await runMain(root, ["export", EXAM, "--dry-run"]);
    expect(r.out).toContain("追加 1 件");
    expect(readFileSync(questionsFile(root), "utf8")).toBe(before);
  });
});

describe("書き出しと解説の誤りの理由の節", () => {
  const lead = "Widget Store では、アカウントがリージョンごとに作れるバケットは 100 個までと定められています。";

  it("誤りの理由の節が選択肢ごとの組の形_書き出した問題の節も、選択肢ごとの組にできる", async () => {
    const root = exportRoot();
    const explanation = `${lead}\n\n## 他の選択肢が誤りである理由\n\n10 個\n\n上限の数値が実際より小さい誤りです。\n\n1,000 個\n\n上限の数値が実際より大きい誤りです。`;
    await prepared(root, true, true, { explanation });
    const r = await runMain(root, ["export", EXAM]);
    expect(r.out).toContain("書き出し: 追加 1 件");
    const added = JSON.parse(readFileSync(questionsFile(root), "utf8")).questions[90];
    expect(added.explanation).toBe(explanation);
    expect(unpairedWrongParagraphs(added.explanation, added.choices)).toBe(0);
  });

  it("誤りの理由の節に選択肢ごとの組にならない段落がある_取り込みで不採用になり、書き出さない", async () => {
    const root = exportRoot();
    const explanation = `${lead}\n\n## 他の選択肢が誤りである理由\n\nほかの選択肢は、上限の数値が違います。`;
    const id = await prepared(root, true, true, { explanation });
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts.find((d) => d.id === id);
    expect(record).toMatchObject({ status: "rejected", reasons: ["style:explanation-wrong-pairs"] });
    const r = await runMain(root, ["export", EXAM]);
    expect(r.out).toContain("追加 0 件");
    expect(JSON.parse(readFileSync(questionsFile(root), "utf8")).questions).toHaveLength(90);
  });
});

describe("採番と出典", () => {
  it("使用済みの番号_最大の次から連番で、接頭辞の違う ID は数えない", () => {
    expect(allocateIds("AIB", ["AIB-0003", "AIB-0010", "CLF-0099"], 2)).toEqual(["AIB-0011", "AIB-0012"]);
    expect(allocateIds("AIB", [], 1)).toEqual(["AIB-0001"]);
    expect(() => allocateIds("AIB", ["AIB-9999"], 1)).toThrow();
  });

  it("出典の URL_許可外のホスト・クエリ付き・重複を落とし、10 件までにする", () => {
    const urls = [
      "https://docs.aws.amazon.com/a.html",
      "https://docs.aws.amazon.com/a.html",
      "https://unlisted.example.com/b.html",
      "https://docs.aws.amazon.com/c.html?x=1",
      ...Array.from({ length: 12 }, (_, i) => `https://docs.aws.amazon.com/p${i}.html`),
    ];
    const kept = references(
      urls.map((url) => ({ url })),
      "AWS",
    );
    expect(kept[0]?.url).toBe("https://docs.aws.amazon.com/a.html");
    expect(kept).toHaveLength(10);
    expect(kept.some((r) => r.url.includes("unlisted") || r.url.includes("?"))).toBe(false);
  });

  it("台帳に題がある出典_題を付け、題がない出典は題なしで残す", () => {
    const kept = references(
      [
        { url: "https://docs.aws.amazon.com/a.html", title: "A の題 - AWS" },
        { url: "https://docs.aws.amazon.com/b.html" },
      ],
      "AWS",
    );
    expect(kept).toEqual([
      { url: "https://docs.aws.amazon.com/a.html", title: "A の題 - AWS" },
      { url: "https://docs.aws.amazon.com/b.html" },
    ]);
  });

  it("同じ URL が題の違いで 2 回ある_最初の 1 件だけ残す", () => {
    const kept = references(
      [
        { url: "https://docs.aws.amazon.com/a.html", title: "最初の題" },
        { url: "https://docs.aws.amazon.com/a.html", title: "後の題" },
      ],
      "AWS",
    );
    expect(kept).toEqual([{ url: "https://docs.aws.amazon.com/a.html", title: "最初の題" }]);
  });
});
