import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChoiceQuestionSchema } from "../contract.ts";
import { assembleQuestion } from "./schema.ts";
import { readDrafts } from "./store.ts";
import {
  baseConfig,
  choiceDraft,
  draftFor,
  EXAM,
  readChoiceRequests,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
} from "./test-helpers.ts";

async function requestOf(root: string) {
  await runMain(root, ["plan", EXAM]);
  await runMain(root, ["draft", EXAM]);
  return readChoiceRequests(root)[0] as ReturnType<typeof readChoiceRequests>[number];
}

describe("誤答の選択肢の解説", () => {
  it("誤答の設計の理由がある_問題の形に組み立てると、その選択肢の解説になり、データの契約に合う", () => {
    const q = assembleQuestion(choiceDraft(), {
      examCode: EXAM,
      domain: "domain1",
      difficulty: "medium",
      references: [],
    }) as { choices: { key: string; explanation?: string }[] };
    const byKey = Object.fromEntries(q.choices.map((c) => [c.key, c.explanation]));
    expect(byKey.A).toBe("上限の数値が実際より小さい誤りです");
    expect(byKey.D).toBe("上限が定められていることを見落とした誤解です");
    expect(byKey.B).toBeUndefined();
    expect(ChoiceQuestionSchema.safeParse(q).success).toBe(true);
  });

  it("選択肢に解説が書かれている_誤答の理由より、選択肢の解説を使う", () => {
    const draft = choiceDraft({
      choices: choiceDraft().choices.map((c) => (c.key === "A" ? { ...c, explanation: "選択肢に書いた解説です" } : c)),
    });
    const q = assembleQuestion(draft, {
      examCode: EXAM,
      domain: "domain1",
      difficulty: "medium",
      references: [],
    }) as {
      choices: { key: string; explanation?: string }[];
    };
    expect(q.choices.find((c) => c.key === "A")?.explanation).toBe("選択肢に書いた解説です");
  });
});

describe("下書きの写しの検査", () => {
  it("解説が根拠の出典の本文を長く写している_本文を残さずに不採用にする", async () => {
    const root = setupDraftRoot();
    const request = await requestOf(root);
    const copied = "A Widget Store holds up to 100 buckets per account in each region.";
    writeOutput(root, request, [draftFor(request, { explanation: `${copied} したがって正解です。` })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out + r.err).toContain("long-copy");
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(record).toMatchObject({ status: "rejected", draft: null });
    expect(record?.reasons).toContain("long-copy");
  });

  it("根拠の出典の本文がキャッシュにない_確かめられないので保留にする", async () => {
    const root = setupDraftRoot();
    const request = await requestOf(root);
    rmSync(join(root, baseConfig.workDir, "cache"), { recursive: true, force: true });
    writeOutput(root, request, [draftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("review-copy-unchecked");
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(record?.status).toBe("held");
    expect(record?.reasons).toContain("review:copy-unchecked");
  });
});

describe("正解の偏り", () => {
  it("公開済みの問題と下書きの正解の記号が 1 つに偏る_記号ごとの件数だけを報告し、取り込みは止めない", async () => {
    const question = (i: number) => ({
      questionId: `AIB-${String(i).padStart(4, "0")}`,
      examCode: EXAM,
      domain: "domain1",
      questionType: "single",
      questionText: `架空の設問 ${i} について、正しいものはどれですか。`,
      choices: ["A", "B", "C", "D"].map((key) => ({ key, text: `選択肢 ${key} の内容 ${i}` })),
      correctAnswers: ["A"],
      explanation: `架空の解説 ${i} です。正解の理由を説明します。`,
    });
    const root = setupDraftRoot({
      questions: { examCode: EXAM, questions: Array.from({ length: 24 }, (_, i) => question(i + 1)) },
    });
    const request = await requestOf(root);
    writeOutput(root, request, [draftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("正解の偏り:");
    expect(r.err).toContain("記号 A");
    expect(r.err).not.toContain("架空の設問");
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.status).toBe("passed");
  });
});

describe("写しの検査の単位", () => {
  it("本文がない出典と、写した本文がある出典を根拠にする_写しとして落とす(保留にしない)", async () => {
    const { BodyCache } = await import("../collect/cache.ts");
    const { copyCheck } = await import("./copy.ts");
    const { card, factsFixture } = await import("../facts/test-helpers.ts");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const body = factsFixture("service-doc.html");
    const cache = new BodyCache(mkdtempSync(join(tmpdir(), "pipeline-copy-")), baseConfig.cache);
    cache.write(Buffer.from(body));
    const present = card({ id: "f-aaaaaaaaaaaa" });
    const absent = card({
      id: "f-bbbbbbbbbbbb",
      sources: [{ ...(present.sources[0] as (typeof present.sources)[number]), contentHash: "c".repeat(64) }],
    });
    const facts = { examCode: EXAM, extracted: [], cards: [present, absent] };
    const copied = choiceDraft({
      factIds: [present.id, absent.id],
      explanation: "A Widget Store holds up to 100 buckets per account in each region. したがって正解です。",
    });
    expect(copyCheck(copied, facts, cache)).toBe("copy");
    expect(copyCheck(choiceDraft({ factIds: [present.id, absent.id] }), facts, cache)).toBe("unchecked");
    expect(copyCheck(choiceDraft({ factIds: [present.id] }), facts, cache)).toBe("ok");
  });
});
