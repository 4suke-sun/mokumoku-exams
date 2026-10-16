import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DecisionsError,
  decisionsPath,
  draftDecision,
  emptyDecisions,
  factDecision,
  orphanDecisions,
  parseDecisions,
  readDecisions,
  sourceAccepted,
  upsertDecisions,
  writeDecisions,
} from "./decisions.ts";

const EXAM = "AWS-AIB-C01";
const HASH = "a".repeat(64);
const URL = "https://docs.aws.amazon.com/guide/a.html";

function file(decisions: unknown[]) {
  return { examCode: EXAM, decisions };
}

describe("人の判断の記録", () => {
  it("出典・事実カード・下書きの判断_スキーマに合えば読める", () => {
    const parsed = parseDecisions(
      file([
        { target: "source", url: URL, contentHash: HASH, decision: "accept", reason: "stale-but-correct" },
        { target: "fact", id: "f-aaaaaaaaaaaa", decision: "release", reason: "not-a-conflict" },
        { target: "draft", id: "d-bbbbbbbbbbbb", decision: "approve", reason: "reviewed" },
      ]),
    );
    expect(factDecision(parsed, "f-aaaaaaaaaaaa")).toBe("release");
    expect(draftDecision(parsed, "d-bbbbbbbbbbbb")).toBe("approve");
    expect(sourceAccepted(parsed, URL, HASH)).toBe(true);
    // 本文が変わると、受け入れは効かない
    expect(sourceAccepted(parsed, URL, "b".repeat(64))).toBe(false);
  });

  it("未知の項目・理由コードの形に合わない値・判断の種類の誤り_読み込みで落ち、場所だけを返す", () => {
    const bad = [
      { target: "draft", id: "d-bbbbbbbbbbbb", decision: "approve", reason: "reviewed", reviewer: "someone-value" },
      { target: "draft", id: "d-bbbbbbbbbbbb", decision: "approve", reason: "自由な文の理由" },
      { target: "fact", id: "f-aaaaaaaaaaaa", decision: "approve", reason: "reviewed" },
      {
        target: "source",
        url: "https://docs.aws.amazon.com/x?q=1",
        contentHash: HASH,
        decision: "accept",
        reason: "ok",
      },
    ];
    for (const d of bad) {
      try {
        parseDecisions(file([d]));
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DecisionsError);
        expect(JSON.stringify((error as DecisionsError).paths)).not.toContain("someone-value");
      }
    }
  });

  it("同じ対象の判断が 2 件ある_読み込みで落ちる", () => {
    const d = { target: "fact", id: "f-aaaaaaaaaaaa", decision: "release", reason: "ok" };
    expect(() => parseDecisions(file([d, { ...d, decision: "reject" }]))).toThrow(DecisionsError);
  });

  it("同じ対象に判断を足す_新しい判断で置き換え、書いて読み直しても同じになる", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-decisions-"));
    const path = decisionsPath(root, EXAM);
    const first = upsertDecisions(emptyDecisions(EXAM), [
      { target: "draft", id: "d-bbbbbbbbbbbb", decision: "release", reason: "ok" },
    ]);
    const second = upsertDecisions(first, [
      { target: "draft", id: "d-bbbbbbbbbbbb", decision: "reject", reason: "wrong-answer" },
    ]);
    writeDecisions(path, second);
    const back = readDecisions(path, EXAM);
    expect(back.decisions).toHaveLength(1);
    expect(draftDecision(back, "d-bbbbbbbbbbbb")).toBe("reject");
    // 誰が判断したかの項目は持たない
    expect(readFileSync(path, "utf8")).not.toMatch(/reviewer|author|email|name/);
  });

  it("記録のファイルがない_空として読み、別の資格の記録は落とす", () => {
    const root = mkdtempSync(join(tmpdir(), "pipeline-decisions-"));
    expect(readDecisions(decisionsPath(root, EXAM), EXAM).decisions).toEqual([]);
    const path = decisionsPath(root, EXAM);
    writeFileSync(path, JSON.stringify({ examCode: "AWS-CLF-C02", decisions: [] }));
    expect(() => readDecisions(path, EXAM)).toThrow(DecisionsError);
  });

  it("対象がなくなった判断_種類ごとに見つける", () => {
    const parsed = parseDecisions(
      file([
        { target: "source", url: URL, contentHash: HASH, decision: "accept", reason: "ok" },
        { target: "fact", id: "f-aaaaaaaaaaaa", decision: "release", reason: "ok" },
        { target: "draft", id: "d-bbbbbbbbbbbb", decision: "approve", reason: "ok" },
      ]),
    );
    const orphans = orphanDecisions(parsed, {
      factIds: ["f-cccccccccccc"],
      draftIds: ["d-bbbbbbbbbbbb"],
      sources: [{ url: URL, contentHash: "b".repeat(64) }],
    });
    expect(orphans.map((d) => d.target).sort()).toEqual(["fact", "source"]);
    // 知らない種類(引数で渡さなかった種類)は、なくなったとみなさない
    expect(orphanDecisions(parsed, {})).toEqual([]);
  });
});
