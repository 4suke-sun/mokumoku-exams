import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsUrl } from "../contract.ts";
import { EXIT } from "../exit-codes.ts";
import { planPath, readPlan } from "../plan/schema.ts";
import { provenancePath, readProvenance } from "./provenance.ts";
import { readDrafts } from "./store.ts";
import { hasEnvValue } from "./style.ts";
import {
  baseConfig,
  draftFixture,
  EXAM,
  fixtureCards,
  fixturePublished,
  readRequests,
  runMain,
  setupDraftRoot,
  stubAgent,
  workPath,
} from "./test-helpers.ts";

/**
 * 出題計画から下書きまでを、固定の事実カード、スタブの応答、架空の既存の問題だけで通す。
 * 通信もモデルも使わない(テストの初期化が、通信を失敗にする)。
 */

const overrides = {
  draft: { ...baseConfig.draft, maxPerRequest: 1, similarity: { duplicate: 1, hold: 0.99 } },
  plan: { ...baseConfig.plan, overrides: { [EXAM]: { targetTotal: 8 } } },
};

function setup() {
  return setupDraftRoot({ cards: fixtureCards(), questions: fixturePublished() });
}

/** draft(依頼)→ スタブの応答 → draft --import を、依頼がなくなるまで繰り返す。繰り返した回数を返す */
async function runToCompletion(root: string, limit = 30): Promise<number> {
  let rounds = 0;
  for (; rounds < limit; rounds++) {
    const request = await runMain(root, ["draft", EXAM], overrides);
    expect(request.code).toBe(EXIT.ok);
    if (readRequests(root).length === 0) break;
    stubAgent(root, rounds * 7);
    const imported = await runMain(root, ["draft", EXAM, "--import"], overrides);
    expect(imported.code).toBe(EXIT.ok);
  }
  return rounds;
}

describe("出題計画から下書きまで", () => {
  it("計画の不足の数だけ下書きができ_すべて通過し_来歴がそろう", async () => {
    const root = setup();
    expect((await runMain(root, ["plan", EXAM], overrides)).code).toBe(EXIT.ok);
    const plan = readPlan(planPath(join(root, baseConfig.workDir), EXAM));
    expect(plan?.targetTotal).toBe(8);
    expect(plan?.existingTotal).toBe(2);
    const missing = plan?.domains.reduce((a, d) => a + d.missing, 0) ?? 0;
    expect(missing).toBe(6);

    await runToCompletion(root);

    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts).toHaveLength(missing);
    expect(drafts.every((d) => d.status === "passed")).toBe(true);
    // 計画の項目ごとの数が、計画どおり
    for (const item of plan?.items ?? []) {
      expect(drafts.filter((d) => d.planItemId === item.id)).toHaveLength(item.count);
    }
    const provenance = readProvenance(provenancePath(join(root, baseConfig.provenanceDir), EXAM), EXAM);
    expect(provenance.entries).toHaveLength(missing);
    expect((await runMain(root, ["draft", EXAM, "--check"], overrides)).code).toBe(EXIT.ok);
  });

  it("同じ実行の依頼_同じ分野でも先頭の事実カードが重ならない", async () => {
    const root = setup();
    await runMain(root, ["plan", EXAM], overrides);
    await runMain(root, ["draft", EXAM], overrides);
    const requests = readRequests(root);
    for (const domain of new Set(requests.map((q) => q.domain.code))) {
      const heads = requests.filter((q) => q.domain.code === domain).map((q) => q.facts[0]?.id);
      // 分野の事実カードは 3 件。3 件目までは重ならない
      expect(new Set(heads.slice(0, 3)).size).toBe(Math.min(3, heads.length));
    }
  });

  it("計画を満たしたあと_同じ入力では再び依頼しない", async () => {
    const root = setup();
    await runMain(root, ["plan", EXAM], overrides);
    await runToCompletion(root);
    const again = await runMain(root, ["draft", EXAM], overrides);
    expect(again.code).toBe(EXIT.ok);
    expect(readRequests(root)).toEqual([]);
    expect(again.out).toContain("依頼 0 件");
  });

  it("種別と難易度が計画に沿う_自由記述と複数選択の下書きもできる", async () => {
    const root = setup();
    // 同じ事実カードを根拠にする下書きは保留になるので、種別の網羅だけを確かめるこのテストでは、保留かどうかは問わない
    const config = {
      ...overrides,
      plan: {
        ...baseConfig.plan,
        typeMix: { single: 0.34, multiple: 0.33, "free-text": 0.33 },
        overrides: { [EXAM]: { targetTotal: 40 } },
      },
    };
    await runMain(root, ["plan", EXAM], config);
    for (let i = 0; i < 30; i++) {
      await runMain(root, ["draft", EXAM], config);
      if (readRequests(root).length === 0) break;
      stubAgent(root, i * 7);
      await runMain(root, ["draft", EXAM, "--import"], config);
    }
    const kinds = new Set(
      readDrafts(workPath(root, "drafts.json"), EXAM)
        .drafts.filter((d) => d.status !== "rejected")
        .map((d) => d.draft?.questionType),
    );
    expect(kinds).toEqual(new Set(["single", "multiple", "free-text"]));
  });

  it("data の公開済みの問題は_どの段階でも変わらない", async () => {
    const root = setup();
    const file = join(root, "data/questions.aws-aib-c01.json");
    const before = readFileSync(file, "utf8");
    await runMain(root, ["plan", EXAM], overrides);
    await runToCompletion(root);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("来歴の台帳は_ID・出典・ハッシュだけで_下書きの本文を含まない", async () => {
    const root = setup();
    await runMain(root, ["plan", EXAM], overrides);
    await runToCompletion(root);
    const text = readFileSync(provenancePath(join(root, baseConfig.provenanceDir), EXAM), "utf8");
    const { topics } = draftFixture<{ topics: string[] }>("stub.json");
    for (const topic of topics) expect(text).not.toContain(topic);
    for (const f of fixtureCards()) expect(text).not.toContain(f.claim);
  });

  it("スタブが誤答の設計を書かなかった_不採用になり_計画の数に数えず_出し直しの依頼になる", async () => {
    const root = setup();
    await runMain(root, ["plan", EXAM], overrides);
    await runMain(root, ["draft", EXAM], overrides);
    const first = readRequests(root).find((q) => q.kind !== "free-text");
    stubAgent(root);
    // 選択式の出力から、誤答の設計を取り除く
    const { readFileSync: read, writeFileSync: write } = await import("node:fs");
    const outPath = join(root, first?.outputPath ?? "");
    const out = JSON.parse(read(outPath, "utf8"));
    out.drafts = out.drafts.map((d: { distractors?: unknown }) => ({ ...d, distractors: undefined }));
    write(outPath, JSON.stringify(out));
    const r = await runMain(root, ["draft", EXAM, "--import"], overrides);
    expect(r.out).toContain("distractor-missing");
    const rejected = readDrafts(workPath(root, "drafts.json"), EXAM).drafts.filter((d) => d.status === "rejected");
    expect(rejected.length).toBeGreaterThan(0);
    expect(rejected.every((d) => d.draft === null)).toBe(true);
  });
});

describe("fixture の衛生", () => {
  const files = ["facts.json", "stub.json", "published.json"];

  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (value !== null && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  }

  it.each(files)("%s_URL・環境固有の値・長い文章を含まない", (name) => {
    for (const text of strings(draftFixture(name))) {
      expect(containsUrl(text)).toBe(false);
      expect(hasEnvValue(text)).toBe(false);
      // 公式の文書の本文の写しを置かない。主張や設問は短い架空の文だけにする
      expect(text.length).toBeLessThanOrEqual(80);
    }
  });

  it("事実カードの fixture_架空のサービス名だけを使う", () => {
    const names = ["Widget Store", "Gadget Queue", "Sprocket Cache", "Gizmo Stream"];
    for (const f of fixtureCards()) expect(names.some((n) => f.claim.includes(n))).toBe(true);
  });
});
