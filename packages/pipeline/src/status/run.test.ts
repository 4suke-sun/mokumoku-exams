import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDrafts } from "../draft/store.ts";
import {
  baseConfig,
  draftFor,
  EXAM,
  markVerified,
  readChoiceRequests,
  readRequests,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
} from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { PIPELINE_ROLES, readAgentStamp } from "../shared/agents.ts";

async function status(root: string) {
  return runMain(root, ["status", EXAM]);
}

/** 状態の行から、「<項目> <数>」を取り出す(例: `通過 1 件`) */
function count(out: string, line: string, label: string): number {
  const text = out.split("\n").find((l) => l.startsWith(`状態: ${line}`)) ?? "";
  const m = new RegExp(`${label} (\\d+) 件`).exec(text);
  return m ? Number(m[1]) : Number.NaN;
}

async function withDrafts() {
  const root = setupDraftRoot();
  await runMain(root, ["plan", EXAM]);
  await runMain(root, ["draft", EXAM]);
  const request = readChoiceRequests(root)[0] as ReturnType<typeof readChoiceRequests>[number];
  writeOutput(root, request, [draftFor(request)]);
  await runMain(root, ["draft", EXAM, "--import"]);
  return root;
}

describe("status", () => {
  it("何もない作業ディレクトリ_件数はすべて 0 で、出題計画なしと報告する", async () => {
    const root = setupDraftRoot({ cards: [] });
    const r = await status(root);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("状態: 出題計画 なし");
    expect(count(r.out, "下書き", "通過")).toBe(0);
    expect(count(r.out, "下書き", "依頼待ち")).toBe(0);
  });

  it("依頼を書いた段階_依頼待ちの件数が、依頼のファイルの数と一致する", async () => {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    const written = readChoiceRequests(root).length;
    const r = await status(root);
    expect(count(r.out, "下書き", "依頼待ち")).toBeGreaterThanOrEqual(written);
    expect(count(r.out, "下書き", "取り込み待ち")).toBe(0);
    // 出力を置くと、依頼待ちから取り込み待ちに移る
    const before = count(r.out, "下書き", "依頼待ち");
    const request = readChoiceRequests(root)[0] as ReturnType<typeof readChoiceRequests>[number];
    writeOutput(root, request, [draftFor(request)]);
    const after = await status(root);
    expect(count(after.out, "下書き", "取り込み待ち")).toBe(1);
    expect(count(after.out, "下書き", "依頼待ち")).toBe(before - 1);
  });

  it("取り込んだ下書き_通過・保留・不採用・書き出し済みの件数が、置き場から数えた値と一致する", async () => {
    const root = await withDrafts();
    const stored = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    const r = await status(root);
    expect(count(r.out, "下書き", "通過")).toBe(stored.filter((d) => d.status === "passed").length);
    expect(count(r.out, "下書き", "保留")).toBe(stored.filter((d) => d.status === "held").length);
    expect(count(r.out, "下書き", "不採用")).toBe(stored.filter((d) => d.status === "rejected").length);
    expect(count(r.out, "下書き", "書き出し済み")).toBe(0);
    expect(count(r.out, "検証", "検証前")).toBe(stored.length);
    // 検証を通ったものは、検証前から外れる
    markVerified(root, stored[0]?.id as string);
    const verified = await status(root);
    expect(count(verified.out, "検証", "合格")).toBe(1);
    expect(count(verified.out, "検証", "検証前")).toBe(stored.length - 1);
  });

  it("保留・不採用がある_理由コードごとの件数を出す", async () => {
    const root = await withDrafts();
    const file = workPath(root, "drafts.json");
    const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.drafts[0].status = "held";
    stored.drafts[0].reasons = ["review:similar-existing", "ambiguous:similar-to-correct"];
    writeFileSync(file, JSON.stringify(stored));
    const r = await status(root);
    expect(r.out).toContain("状態: 下書きの理由 ambiguous:similar-to-correct 1 件");
    expect(r.out).toContain("状態: 下書きの理由 review:similar-existing 1 件");
  });

  it("計画の項目が事実カードのない分野_未達の理由を項目ごとに出す", async () => {
    const root = setupDraftRoot({ cards: [] });
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    const r = await status(root);
    expect(r.out).toMatch(/状態: 未達 p-[0-9a-f]{12} no-facts/);
  });

  it("役のモデルと定義のハッシュ_すべての役を出し、依頼待ちの件数 × モデルの見積もりを出す。費用は測らない", async () => {
    const root = await withDrafts();
    const r = await status(root);
    for (const role of PIPELINE_ROLES) {
      const stamp = readAgentStamp(root, role);
      expect(r.out).toContain(`状態: 役 ${role} ${stamp.model} 定義 ${stamp.definitionHash.slice(0, 12)}`);
      expect(r.out).toMatch(new RegExp(`見積もり .*${role} \\d+ 件 × ${stamp.model}`));
    }
    expect(r.out).toContain(`1 回の実行の上限 ${100} 件`);
    expect(r.out).not.toMatch(/費用|トークン|円|ドル/);
  });

  it("直しの依頼と下書きの依頼が混ざる_依頼待ちを直しの役と下書きの作成役に分けて数え、出力が済んだ依頼と読めない依頼は直しに数えない", async () => {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    // 下書きの依頼(選択式と自由記述)の数。直しの依頼と読めない依頼を置く前に数える
    const drafted = readRequests(root).length;
    const done = readChoiceRequests(root)[0] as ReturnType<typeof readChoiceRequests>[number];
    const requestsDir = workPath(root, "requests");
    // 直しの依頼(revise を持つ)を 3 件と、読めない依頼を 1 件置く。依頼待ちの数え方だけを見るので、中身は最小にする
    for (const n of [1, 2, 3]) {
      writeFileSync(
        join(requestsDir, `revise-${n}.json`),
        JSON.stringify({ revise: { draftId: `d-00000000000${n}` } }),
      );
    }
    writeFileSync(join(requestsDir, "broken.json"), '{"revise": ');
    // 直しの依頼 1 件と、下書きの依頼 1 件は、出力が済んでいる
    const outDir = workPath(root, "out");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "revise-3.json"), "{}");
    writeOutput(root, done, [draftFor(done)]);
    const waiting = (out: string, role: string) => {
      const m = new RegExp(`見積もり .*${role} (\\d+) 件`).exec(out);
      return m ? Number(m[1]) : Number.NaN;
    };
    const r = await status(root);
    expect(r.code).toBe(EXIT.ok);
    expect(waiting(r.out, "question-reviser")).toBe(2);
    // 下書きの作成役: 出力のない下書きの依頼と、読めない依頼(直しとして数えない)
    expect(waiting(r.out, "question-drafter")).toBe(drafted - 1 + 1);
    expect(count(r.out, "下書き", "依頼待ち")).toBe(drafted - 1 + 2 + 1);
  });

  it("再検証の印がある_件数を出す", async () => {
    const root = await withDrafts();
    const { ledgerPath, readLedger, writeLedger } = await import("../collect/ledger.ts");
    const path = ledgerPath(join(root, baseConfig.ledgerDir), EXAM);
    writeLedger(path, {
      ...readLedger(path, EXAM),
      recheck: { facts: ["f-aaaaaaaaaaaa", "f-bbbbbbbbbbbb"], questions: ["d-1"] },
    });
    const r = await status(root);
    expect(r.out).toContain("状態: 再検証の印 事実カード 2 件、下書き・問題 1 件");
  });

  it("実行しても何も書かない_作業用の置き場とコミットする台帳が変わらない", async () => {
    const root = await withDrafts();
    const files = [workPath(root, "drafts.json"), workPath(root, "state.json")];
    const snapshot = files.map((f) => readFileSync(f, "utf8"));
    await status(root);
    expect(files.map((f) => readFileSync(f, "utf8"))).toEqual(snapshot);
  });

  it("壊れたファイル_場所だけを報告して終了コード 1 になり、本文を出さない", async () => {
    const root = await withDrafts();
    writeFileSync(workPath(root, "drafts.json"), '{"examCode": "秘密の本文", ');
    const factsFile = join(root, baseConfig.factsDir, "aws-aib-c01.json");
    mkdirSync(join(factsFile, ".."), { recursive: true });
    writeFileSync(factsFile, "{壊れた本文");
    const r = await status(root);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("下書きの誤り: (JSON の形)");
    expect(r.err).toContain("事実カードの誤り: (JSON の形)");
    expect(r.out + r.err).not.toContain("秘密の本文");
    expect(r.out + r.err).not.toContain("壊れた本文");
    expect(r.out).not.toContain("状態:");
  });

  it("資格マスタにない資格コード_入力の誤り", async () => {
    const root = setupDraftRoot();
    expect((await runMain(root, ["status", "AWS-ZZZ-C01"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["status"])).code).toBe(EXIT.inputError);
  });
});
