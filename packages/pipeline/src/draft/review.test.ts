import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, readDecisions } from "../decisions/decisions.ts";
import { EXIT } from "../exit-codes.ts";
import { DOC_URL } from "../facts/test-helpers.ts";
import { readDrafts } from "./store.ts";
import {
  baseConfig,
  draftFor,
  EXAM,
  readChoiceRequests,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
} from "./test-helpers.ts";

/** 計画 → 依頼 → 取り込みまで進め、通過した下書きを 1 件作る */
async function imported(root: string) {
  await runMain(root, ["plan", EXAM]);
  await runMain(root, ["draft", EXAM]);
  const request = readChoiceRequests(root)[0] as ReturnType<typeof readChoiceRequests>[number];
  writeOutput(root, request, [draftFor(request)]);
  await runMain(root, ["draft", EXAM, "--import"]);
  return readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.id as string;
}

type Sheet = { examCode: string; items: { id: string; decision: string | null; reason: string | null }[] };
const sheetPath = (root: string) => workPath(root, "review-sheet.json");
const readSheet = (root: string) => JSON.parse(readFileSync(sheetPath(root), "utf8")) as Sheet;

describe("draft --review と --decide", () => {
  it("通過した下書き_表に設問文・正答・根拠の主張・出典の URL が載り、判断のシートに未記入で並ぶ", async () => {
    const root = setupDraftRoot();
    const id = await imported(root);
    const r = await runMain(root, ["draft", EXAM, "--review"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("人の確認: 対象 1 件、承認 0 件、却下 0 件、未済 1 件");
    const md = readFileSync(workPath(root, "review.md"), "utf8");
    const draft = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.draft;
    expect(md).toContain(`## ${id}`);
    expect(md).toContain("(正答)");
    expect(md).toContain("架空の主張");
    expect(md).toMatch(/\| 出典 \| https:\/\//);
    // 検証役が読む根拠の節の場所(出典の URL・節の名前・見出し)が載る
    expect(md).toContain(`| 検証の節 | ${DOC_URL}(節: Quotas and limits、見出し: quotas) |`);
    expect(md).toContain((draft?.questionText ?? "").slice(0, 10));
    expect(readSheet(root).items).toEqual([{ id, decision: null, reason: null }]);
  });

  it("シートに承認を書いて取り込む_人の判断の記録に入り、確認済みに数える。誰が判断したかは記録しない", async () => {
    const root = setupDraftRoot();
    const id = await imported(root);
    await runMain(root, ["draft", EXAM, "--review"]);
    const sheet = readSheet(root);
    writeFileSync(
      sheetPath(root),
      JSON.stringify({ ...sheet, items: [{ id, decision: "approve", reason: "reviewed" }] }),
    );
    const r = await runMain(root, ["draft", EXAM, "--decide"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("判断の取り込み: 1 件、未記入 0 件");
    expect(r.out).toContain("承認 1 件、却下 0 件、未済 0 件");
    const path = decisionsPath(join(root, baseConfig.decisionsDir), EXAM);
    expect(readDecisions(path, EXAM).decisions).toEqual([
      { target: "draft", id, decision: "approve", reason: "reviewed" },
    ]);
    // --check も、済み・未済の件数を報告する
    expect((await runMain(root, ["draft", EXAM, "--check"])).out).toContain("未済 0 件");
  });

  it("シートの誤り(理由のない判断・知らない下書き・保留でない下書きの解除・人の名前の項目)_取り込まず、行の番号と種類だけを出す", async () => {
    const root = setupDraftRoot();
    const id = await imported(root);
    await runMain(root, ["draft", EXAM, "--review"]);
    const write = (items: unknown[]) => writeFileSync(sheetPath(root), JSON.stringify({ examCode: EXAM, items }));
    const path = decisionsPath(join(root, baseConfig.decisionsDir), EXAM);

    write([
      { id, decision: "approve", reason: null },
      { id: "d-aaaaaaaaaaaa", decision: "reject", reason: "x" },
    ]);
    const bad = await runMain(root, ["draft", EXAM, "--decide"]);
    expect(bad.code).toBe(EXIT.checkFailed);
    expect(bad.err).toContain("判断のシートの誤り: items.0 missing-reason");
    expect(bad.err).toContain("判断のシートの誤り: items.1 unknown-draft");

    write([{ id, decision: "release", reason: "ok" }]);
    expect((await runMain(root, ["draft", EXAM, "--decide"])).err).toContain("items.0 release-not-held");

    write([{ id, decision: "approve", reason: "ok", reviewer: "name-value" }]);
    const extra = await runMain(root, ["draft", EXAM, "--decide"]);
    expect(extra.code).toBe(EXIT.checkFailed);
    expect(extra.out + extra.err).not.toContain("name-value");
    expect(readDecisions(path, EXAM).decisions).toEqual([]);
  });

  it("シートがない_入力の誤りで終わる", async () => {
    const root = setupDraftRoot();
    await imported(root);
    expect((await runMain(root, ["draft", EXAM, "--decide"])).code).toBe(EXIT.inputError);
  });
});
