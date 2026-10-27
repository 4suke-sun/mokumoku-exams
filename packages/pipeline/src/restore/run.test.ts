import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { provenancePath, readProvenance } from "../draft/provenance.ts";
import {
  approve,
  REWRITE_ID,
  readyToRestore,
  rewriteAndImport,
  setupRewriteRoot,
  writeRewriteJudgement,
} from "../draft/rewrite-test-helpers.ts";
import { baseConfig, EXAM, markVerified, runMain } from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";

const QUESTIONS = "data/questions.aws-aib-c01.json";
const UNPUBLISHED = "data/unpublished.aws-aib-c01.json";
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
const publishedIds = (root: string) =>
  (JSON.parse(read(root, QUESTIONS)) as { questions: { questionId: string }[] }).questions.map((q) => q.questionId);

describe("restore", () => {
  it("書き直して検証・承認・判定(公開)を通った問題_同じ ID のまま、非公開のファイルから公開のファイルへ戻す", async () => {
    const root = setupRewriteRoot();
    await readyToRestore(root);
    const r = await runMain(root, ["restore", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    // 公開の問題 ID の順を保つ(自分より大きい ID の手前)
    expect(publishedIds(root)).toEqual([REWRITE_ID, "AIB-0002", "AIB-0003", "AIB-0004", "AIB-0005", "AIB-0006"]);
    // 非公開のファイルは、最後の 1 件が戻ったので消える
    expect(existsSync(join(root, UNPUBLISHED))).toBe(false);
    const restored = (JSON.parse(read(root, QUESTIONS)) as { questions: { questionId: string; explanation: string }[] })
      .questions[0];
    expect(restored?.explanation).toContain("100 個まで");
    expect(r.out).toContain(`公開への復帰: ${REWRITE_ID} を公開へ戻した`);
  });

  it("戻したあと_来歴は書き直した下書きの項目に問題の ID を持ち、元の問題の古い項目は外れる。再実行しても何も変わらない", async () => {
    const root = setupRewriteRoot();
    const draft = await readyToRestore(root);
    await runMain(root, ["restore", EXAM]);
    const provenance = readProvenance(provenancePath(join(root, baseConfig.provenanceDir), EXAM), EXAM);
    expect(provenance.entries.map((e) => [e.draftId, e.questionId])).toEqual([[draft.id, REWRITE_ID]]);
    const before = read(root, QUESTIONS);
    const again = await runMain(root, ["restore", EXAM]);
    expect(again.code, again.err).toBe(EXIT.ok);
    expect(read(root, QUESTIONS)).toBe(before);
  });

  it("元の問題のタグ_書き直した問題に引き継ぐ", async () => {
    const root = setupRewriteRoot({ question: { tags: ["quota"] } });
    await readyToRestore(root);
    await runMain(root, ["restore", EXAM]);
    const restored = (JSON.parse(read(root, QUESTIONS)) as { questions: { tags?: string[] }[] }).questions[0];
    expect(restored?.tags).toEqual(["quota"]);
  });

  it("dry-run_何も書かない", async () => {
    const root = setupRewriteRoot();
    await readyToRestore(root);
    const published = read(root, QUESTIONS);
    const r = await runMain(root, ["restore", EXAM, "--dry-run"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("書き込みをしない(dry-run)");
    expect(read(root, QUESTIONS)).toBe(published);
    expect(existsSync(join(root, UNPUBLISHED))).toBe(true);
  });

  describe("戻さない条件", () => {
    /** 条件を 1 つ崩して restore を実行し、理由を報告して何も書かないことを確かめる */
    async function expectKept(root: string, reason: string) {
      const published = read(root, QUESTIONS);
      const unpublished = read(root, UNPUBLISHED);
      const r = await runMain(root, ["restore", EXAM]);
      expect(r.code).toBe(EXIT.checkFailed);
      expect(r.out).toContain(`公開に戻さない: ${REWRITE_ID} ${reason}`);
      expect(read(root, QUESTIONS)).toBe(published);
      expect(read(root, UNPUBLISHED)).toBe(unpublished);
    }

    it("人が承認していない_戻さない(抜き取りで確認しないと記録していても同じ)", async () => {
      const root = setupRewriteRoot();
      const draft = await rewriteAndImport(root);
      markVerified(root, draft.id);
      writeRewriteJudgement(root, draft);
      await expectKept(root, "not-approved");
    });

    it("検証を通っていない_戻さない", async () => {
      const root = setupRewriteRoot();
      const draft = await rewriteAndImport(root);
      approve(root, draft.id);
      writeRewriteJudgement(root, draft);
      await expectKept(root, "not-verified");
    });

    it("判定の結果がない_戻さない", async () => {
      const root = setupRewriteRoot();
      const draft = await rewriteAndImport(root);
      markVerified(root, draft.id);
      approve(root, draft.id);
      await expectKept(root, "judge-missing-or-stale");
    });

    it("判定のあとに本文が変わった(本文のハッシュが違う)_戻さない", async () => {
      const root = setupRewriteRoot();
      const draft = await readyToRestore(root);
      writeRewriteJudgement(root, draft, { contentHash: "c".repeat(64) });
      await expectKept(root, "judge-missing-or-stale");
    });

    it("判定の基準が変わった(基準のハッシュが違う)_戻さない", async () => {
      const root = setupRewriteRoot();
      const draft = await readyToRestore(root);
      writeRewriteJudgement(root, draft, { criteriaHash: "d".repeat(64) });
      await expectKept(root, "judge-missing-or-stale");
    });

    it("判定が公開でない_戻さない", async () => {
      const root = setupRewriteRoot();
      const draft = await readyToRestore(root);
      writeRewriteJudgement(root, draft, { verdict: "rewritable" });
      await expectKept(root, "judge-rewritable");
    });

    it("来歴の検査に落ちる(根拠の事実カードが通過でなくなった)_戻さない", async () => {
      const root = setupRewriteRoot();
      await readyToRestore(root);
      const path = join(root, baseConfig.factsDir, `${EXAM.toLowerCase()}.json`);
      const facts = JSON.parse(readFileSync(path, "utf8")) as { cards: { id: string; status: string }[] };
      facts.cards = facts.cards.map((c) => (c.id === "f-00000000000a" ? { ...c, status: "held" } : c));
      writeFileSync(path, JSON.stringify(facts));
      await expectKept(root, "provenance");
    });

    it("元の問題が判定のあとに公開へ戻された(非公開のファイルにない)_戻さない", async () => {
      const root = setupRewriteRoot();
      await readyToRestore(root);
      writeFileSync(
        join(root, UNPUBLISHED),
        JSON.stringify({
          examCode: EXAM,
          entries: [
            {
              verdict: "unpublish",
              reasons: ["judge:not-unique"],
              question: JSON.parse(read(root, UNPUBLISHED)).entries[0].question,
            },
          ],
        }),
      );
      await expectKept(root, "not-rewritable");
    });
  });

  it("2 問の書き直しのうち 1 問だけが条件を満たす_満たす問題だけを戻し、残りを報告して終了コード 1 にする", async () => {
    const root = setupRewriteRoot();
    await readyToRestore(root);
    const unpublishedPath = join(root, UNPUBLISHED);
    const file = JSON.parse(readFileSync(unpublishedPath, "utf8")) as {
      entries: { question: Record<string, unknown> }[];
    };
    file.entries.push({
      ...file.entries[0],
      question: { ...file.entries[0]?.question, questionId: "AIB-0009" },
    } as never);
    writeFileSync(unpublishedPath, JSON.stringify(file));
    // 2 問目の書き直しの下書き(承認なし)
    const drafts = JSON.parse(
      readFileSync(join(root, baseConfig.workDir, "draft", EXAM.toLowerCase(), "drafts.json"), "utf8"),
    );
    drafts.drafts.push({ ...drafts.drafts[0], id: "d-0000000000bb", rewriteOf: "AIB-0009" });
    writeFileSync(join(root, baseConfig.workDir, "draft", EXAM.toLowerCase(), "drafts.json"), JSON.stringify(drafts));
    const r = await runMain(root, ["restore", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.out).toContain("公開に戻さない: AIB-0009 not-approved");
    expect(publishedIds(root)).toContain(REWRITE_ID);
    expect(existsSync(unpublishedPath)).toBe(true);
  });

  it("書き直しの下書きがない_何もせず終わる", async () => {
    const root = setupRewriteRoot();
    const r = await runMain(root, ["restore", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("書き直した下書き 0 件のうち、戻す 0 問、戻さない 0 問");
  });

  it("非公開のファイルがない_戻す問題がないと報告して終わる。形が違うときは入力の誤り", async () => {
    const root = setupRewriteRoot();
    writeFileSync(join(root, UNPUBLISHED), "");
    const broken = await runMain(root, ["restore", EXAM]);
    expect(broken.code).toBe(EXIT.inputError);
    rmSync(join(root, UNPUBLISHED));
    const gone = await runMain(root, ["restore", EXAM]);
    expect(gone.code, gone.err).toBe(EXIT.ok);
    expect(gone.out).toContain("戻す問題がない");
  });
});

describe("書き直しの下書きと、ほかの段階", () => {
  it("export_書き直しの下書きは、採番して公開に足さない", async () => {
    const root = setupRewriteRoot();
    await readyToRestore(root);
    const before = read(root, QUESTIONS);
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(read(root, QUESTIONS)).toBe(before);
  });

  it("judge_検証を通った書き直しの下書きだけを、元の問題の ID で判定に出す", async () => {
    const root = setupRewriteRoot();
    const draft = await rewriteAndImport(root);
    await runMain(root, ["judge", EXAM]);
    expect(readdirSyncJudge(root)).not.toContain(REWRITE_ID);
    markVerified(root, draft.id);
    const verified = await runMain(root, ["judge", EXAM]);
    expect(verified.code, verified.err).toBe(EXIT.ok);
    const requests = readdirSyncJudge(root);
    expect(requests).toContain(REWRITE_ID);
  });
});

function readdirSyncJudge(root: string): string {
  const dir = join(root, baseConfig.workDir, "judge", EXAM.toLowerCase(), "requests");
  // 依頼のファイルの中身を連結して返す(問題の ID を探す)
  return existsSync(dir)
    ? readdirSync(dir)
        .map((f) => readFileSync(join(dir, f), "utf8"))
        .join("\n")
    : "";
}
