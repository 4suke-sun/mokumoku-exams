import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DraftRecord, readDrafts, writeDrafts } from "../draft/store.ts";
import {
  baseConfig,
  draftFor,
  EXAM,
  freeTextDraftFor,
  readRequests,
  runMain,
  setupDraftRoot,
  stubAgent,
  workPath,
  writeOutput,
} from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { judgeRederive } from "./check.ts";
import { type VerifyRequest, VerifyRequestSchema } from "./request.ts";
import { heavier, isVerified, VERIFY_CODES, VerificationSchema } from "./schema.ts";

/** 計画 → 依頼 → 下書きの取り込みまで進め、通過した選択式の下書きを 1 件作る */
async function withDraft(kind: "choice" | "free-text" = "choice") {
  const root = setupDraftRoot();
  await runMain(root, ["plan", EXAM]);
  await runMain(root, ["draft", EXAM]);
  const requests = readRequests(root);
  // 依頼の鍵の順は定義のハッシュで変わるので、種別で選ぶ(選択式は単一選択)
  const request = requests.find((q) => (kind === "choice" ? q.kind === "single" : q.kind === "free-text"));
  if (!request) throw new Error("依頼がない");
  writeOutput(root, request, [kind === "choice" ? draftFor(request) : freeTextDraftFor(request)]);
  expect((await runMain(root, ["draft", EXAM, "--import"])).code).toBe(EXIT.ok);
  return root;
}

const draftsPath = (root: string) => workPath(root, "drafts.json");
const records = (root: string) => readDrafts(draftsPath(root), EXAM).drafts;
const first = (root: string) => records(root)[0] as DraftRecord;
const verifyDir = (root: string, ...parts: string[]) =>
  join(root, baseConfig.workDir, "verify", "aws-aib-c01", ...parts);

function verifyRequests(root: string): VerifyRequest[] {
  const dir = verifyDir(root, "requests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((f) => VerifyRequestSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

function writeVerifierOutput(root: string, request: VerifyRequest, body: object) {
  const path = join(root, request.outputPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      examCode: request.examCode,
      requestKey: request.requestKey,
      draftId: request.draftId,
      check: request.check,
      ...body,
    }),
  );
}

/** 検証役の再導出。宣言した正解の記号を渡し、overrides で記号ごとの判定を変える */
function rederiveBody(
  request: VerifyRequest,
  correct: readonly string[],
  overrides: Record<string, "correct" | "incorrect" | "unknown"> = {},
  heading = request.sections[0]?.heading ?? "",
) {
  if (request.check !== "rederive") throw new Error("再導出の依頼ではない");
  return {
    judgements: request.choices.map((c) => {
      const judgement = overrides[c.key] ?? (correct.includes(c.key) ? "correct" : "incorrect");
      return {
        key: c.key,
        judgement,
        evidence: judgement === "unknown" ? null : { heading, summary: "節の内容と整合する(言い換え)" },
      };
    }),
  };
}

const correctOf = (root: string): string[] => {
  const draft = first(root).draft;
  return draft !== null && "correctAnswers" in draft ? draft.correctAnswers : [];
};

async function rederiveWith(
  root: string,
  overrides: Record<string, "correct" | "incorrect" | "unknown"> = {},
  heading?: string,
) {
  await runMain(root, ["verify", EXAM]);
  const request = verifyRequests(root)[0] as VerifyRequest;
  writeVerifierOutput(root, request, rederiveBody(request, correctOf(root), overrides, heading));
  return runMain(root, ["verify", EXAM, "--import"]);
}

describe("verify の依頼", () => {
  it("通過した下書き_設問文・選択肢・根拠の節だけを載せ、正解・解説・誤答の設計・事実カードの主張は載せない", async () => {
    const root = await withDraft();
    const r = await runMain(root, ["verify", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("検証の依頼: pipeline-work/verify/aws-aib-c01/requests/");
    const text = readFileSync(
      join(verifyDir(root, "requests"), readdirSync(verifyDir(root, "requests"))[0] as string),
      "utf8",
    );
    const draft = first(root).draft;
    const request = JSON.parse(text);
    expect(request.check).toBe("rederive");
    expect(request.questionText).toBe(draft?.questionText);
    expect(request.sections[0].heading).toBe("quotas");
    expect(request.sections[0].text).toContain("100 buckets per account");
    expect(Object.keys(request).sort()).toEqual([
      "agent",
      "check",
      "choices",
      "draftId",
      "evidenceHash",
      "examCode",
      "kind",
      "outputPath",
      "questionText",
      "requestKey",
      "sections",
    ]);
    expect(request.choices.every((c: object) => Object.keys(c).sort().join() === "key,text")).toBe(true);
    for (const secret of ["correctAnswers", "distractors", "explanation", "架空の主張", draft?.explanation ?? ""]) {
      expect(text).not.toContain(secret);
    }
    expect(request.agent.role).toBe("question-verifier");
    expect(request.agent.model).toBe("claude-opus-5-5");
  });

  it("同じ入力で再実行_待っている依頼を増やさず、依頼の鍵は変わらない", async () => {
    const root = await withDraft();
    await runMain(root, ["verify", EXAM]);
    const keys = verifyRequests(root).map((q) => q.requestKey);
    const again = await runMain(root, ["verify", EXAM]);
    expect(again.out).toContain("依頼 0 件、依頼済みで待っている 1 件");
    expect(verifyRequests(root).map((q) => q.requestKey)).toEqual(keys);
  });

  it("根拠の節を取り出せない_依頼を出さず、理由を報告して止まる(通す側に倒さない)", async () => {
    const root = await withDraft();
    // 見出しが本文にない
    const factsFile = join(root, baseConfig.factsDir, "aws-aib-c01.json");
    const facts = JSON.parse(readFileSync(factsFile, "utf8"));
    for (const c of facts.cards) c.sources[0].anchor.heading = "no-such-heading";
    writeFileSync(factsFile, JSON.stringify(facts));
    const r = await runMain(root, ["verify", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("検証の節なし:");
    expect(r.err).toContain("anchor-not-found");
    expect(verifyRequests(root)).toEqual([]);
    expect(first(root).verification).toBeUndefined();
  });

  it("根拠の本文がキャッシュにない_依頼を出さず、body-not-cached で止まる", async () => {
    const root = await withDraft();
    rmSync(join(root, baseConfig.workDir, "cache"), { recursive: true, force: true });
    const r = await runMain(root, ["verify", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("body-not-cached");
    expect(verifyRequests(root)).toEqual([]);
  });

  it("下書きが根拠の節の本文を写している_モデルを呼ぶ前に不採用にし、依頼を出さない。本文は残さない", async () => {
    const root = await withDraft();
    const file = draftsPath(root);
    const stored = readDrafts(file, EXAM);
    const copied = "A Widget Store holds up to 100 buckets per account in each region.";
    writeDrafts(file, {
      ...stored,
      drafts: stored.drafts.map((d) => (d.draft ? { ...d, draft: { ...d.draft, explanation: copied } } : d)),
    });
    const r = await runMain(root, ["verify", EXAM]);
    expect(r.out).toContain("検証の不採用:");
    expect(verifyRequests(root)).toEqual([]);
    const record = first(root);
    expect(record.status).toBe("rejected");
    expect(record.draft).toBeNull();
    expect(record.reasons).toEqual(["verify:copy"]);
    expect(record.verification?.verdict).toBe("reject");
    expect(readFileSync(file, "utf8")).not.toContain("holds up to 100 buckets");
  });

  it("自由記述の下書き_モデルを呼ばず、人が確かめるものとして保留にする", async () => {
    const root = await withDraft("free-text");
    const r = await runMain(root, ["verify", EXAM]);
    expect(r.out).toContain("verify:free-text-unchecked");
    expect(verifyRequests(root)).toEqual([]);
    expect(first(root)).toMatchObject({ status: "held", reasons: ["verify:free-text-unchecked"] });
    expect(first(root).verification?.verdict).toBe("hold");
  });

  it("dry-run_依頼を書かず、下書きの状態も変えない", async () => {
    const root = await withDraft();
    const r = await runMain(root, ["verify", EXAM, "--dry-run"]);
    expect(r.out).toContain("依頼 1 件");
    expect(verifyRequests(root)).toEqual([]);
    expect(first(root).verification).toBeUndefined();
  });
});

describe("verify --import: 再導出", () => {
  it("再導出が宣言した正解と一致_解説の確認に進み、その依頼で初めて正解と解説を載せる", async () => {
    const root = await withDraft();
    const r = await rederiveWith(root);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("解説の確認待ち 1 件");
    const pending = first(root);
    expect(pending.verification).toMatchObject({ verdict: null, checks: { rederive: { result: "pass" } } });
    expect(pending.status).toBe("passed");
    expect(isVerified(pending.verification, undefined)).toBe(false);
    // 再導出の依頼と出力は片づく。次の実行で、解説の確認の依頼が出る
    expect(verifyRequests(root)).toEqual([]);
    await runMain(root, ["verify", EXAM]);
    const next = verifyRequests(root)[0] as VerifyRequest;
    expect(next.check).toBe("explanation");
    if (next.check !== "explanation") return;
    expect(next.correctAnswers).toEqual(correctOf(root));
    expect(next.explanation).toBe(first(root).draft?.explanation);
    expect(next.locations).toContain("explanation");
    expect(next.locations.some((l) => l.startsWith("distractors."))).toBe(true);
  });

  it("解説に指摘がない_検証を通った合格になる。記録は判定・検査の結果・定義だけで、本文を含まない", async () => {
    const root = await withDraft();
    await rederiveWith(root);
    await runMain(root, ["verify", EXAM]);
    const request = verifyRequests(root)[0] as VerifyRequest;
    writeVerifierOutput(root, request, { findings: [] });
    const r = await runMain(root, ["verify", EXAM, "--import"]);
    expect(r.out).toContain("検証の合格:");
    const record = first(root);
    expect(record.status).toBe("passed");
    expect(record.verification).toMatchObject({
      verdict: "pass",
      reasons: [],
      findings: [],
      checks: { copy: { result: "pass" }, rederive: { result: "pass" }, explanation: { result: "pass" } },
    });
    expect(record.verification?.agent?.role).toBe("question-verifier");
    expect(isVerified(record.verification, undefined)).toBe(true);
    expect(VerificationSchema.safeParse(record.verification).success).toBe(true);
    // 検証前の passed と、検証を通った合格は、記録で区別できる
    const stored = JSON.stringify(record.verification);
    expect(stored).not.toContain("100 buckets");
    expect(stored).not.toContain(record.draft?.questionText ?? "?");
    // 同じ入力では、再び依頼しない
    const again = await runMain(root, ["verify", EXAM]);
    expect(again.out).toContain("依頼 0 件、依頼済みで待っている 0 件、検証済みで飛ばした 1 件");
  });

  it.each([
    ["正解の選択肢が節では誤り", { override: "correct-wrong", code: "verify:answer-mismatch" }],
    ["誤答の選択肢が節では正しい", { override: "distractor-right", code: "verify:distractor-correct" }],
    ["判定できない選択肢がある", { override: "unknown", code: "verify:undetermined" }],
  ])("%s_保留にして、理由コードを残す。解説の確認には進まない", async (_, { override, code }) => {
    const root = await withDraft();
    const correct = correctOf(root);
    const wrong = ["A", "B", "C", "D"].find((k) => !correct.includes(k)) as string;
    const overrides: Record<string, "correct" | "incorrect" | "unknown"> =
      override === "correct-wrong"
        ? { [correct[0] as string]: "incorrect" }
        : override === "distractor-right"
          ? { [wrong]: "correct" }
          : { [wrong]: "unknown" };
    const r = await rederiveWith(root, overrides);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain(`検証の保留:`);
    const record = first(root);
    expect(record.status).toBe("held");
    expect(record.reasons).toEqual([code]);
    expect(record.verification).toMatchObject({
      verdict: "hold",
      reasons: [code],
      checks: { rederive: { result: "hold" } },
    });
    expect(record.verification?.checks.rederive?.choices.length).toBe(4);
    expect(record.verification?.checks.explanation).toBeUndefined();
    expect(isVerified(record.verification, undefined)).toBe(false);
    await runMain(root, ["verify", EXAM]);
    expect(verifyRequests(root)).toEqual([]);
  });

  it("判定の根拠の見出しが節にない_evidence-not-found で保留にする。複数の理由は、すべて残す", async () => {
    const root = await withDraft();
    const correct = correctOf(root);
    await rederiveWith(root, { [correct[0] as string]: "incorrect" }, "no-such-heading");
    expect(first(root).reasons).toEqual(["verify:answer-mismatch", "verify:evidence-not-found"]);
    expect(first(root).verification?.verdict).toBe("hold");
  });

  it("解説に指摘がある_場所と理由コードを残して保留にする", async () => {
    const root = await withDraft();
    await rederiveWith(root);
    await runMain(root, ["verify", EXAM]);
    const request = verifyRequests(root)[0] as VerifyRequest;
    const location =
      request.check === "explanation" ? (request.locations.find((l) => l.startsWith("distractors.")) as string) : "";
    writeVerifierOutput(root, request, {
      findings: [
        { where: location, code: "reason-wrong" },
        { where: "explanation", code: "overclaim" },
        { where: "explanation", code: "explanation-conflict" },
      ],
    });
    await runMain(root, ["verify", EXAM, "--import"]);
    const record = first(root);
    expect(record.status).toBe("held");
    expect(record.reasons).toEqual(["verify:explanation-conflict", "verify:overclaim", "verify:reason-wrong"]);
    expect(record.verification?.findings).toEqual([
      { where: location, code: "reason-wrong" },
      { where: "explanation", code: "explanation-conflict" },
      { where: "explanation", code: "overclaim" },
    ]);
    expect(record.verification?.checks).toMatchObject({
      rederive: { result: "pass" },
      explanation: { result: "hold" },
    });
  });

  it("解説の指摘の場所が依頼にないもの_出力の誤りとして取り込まない", async () => {
    const root = await withDraft();
    await rederiveWith(root);
    await runMain(root, ["verify", EXAM]);
    const request = verifyRequests(root)[0] as VerifyRequest;
    writeVerifierOutput(root, request, { findings: [{ where: "choices.Z.explanation", code: "overclaim" }] });
    const r = await runMain(root, ["verify", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("output-invalid");
    expect(first(root).verification?.verdict).toBeNull();
  });
});

describe("verify --import: 保留を解く", () => {
  async function ambiguousDraft(reasons: string[]) {
    const root = await withDraft();
    const file = draftsPath(root);
    const stored = readDrafts(file, EXAM);
    writeDrafts(file, { ...stored, drafts: stored.drafts.map((d) => ({ ...d, status: "held", reasons })) });
    return root;
  }

  async function verifyToEnd(root: string, overrides: Record<string, "correct" | "incorrect" | "unknown"> = {}) {
    await rederiveWith(root, overrides);
    if (first(root).verification?.verdict !== null) return;
    await runMain(root, ["verify", EXAM]);
    writeVerifierOutput(root, verifyRequests(root)[0] as VerifyRequest, { findings: [] });
    await runMain(root, ["verify", EXAM, "--import"]);
  }

  it("ambiguous の保留_再導出が宣言した正解と一致すると保留が解ける", async () => {
    const root = await ambiguousDraft(["ambiguous:multiple-correct"]);
    await verifyToEnd(root);
    expect(first(root)).toMatchObject({ status: "passed", reasons: [] });
    expect(first(root).verification?.verdict).toBe("pass");
  });

  it("ambiguous の保留_再導出が一致しないと保留のまま(理由は足される)", async () => {
    const root = await ambiguousDraft(["ambiguous:multiple-correct"]);
    const wrong = ["A", "B", "C", "D"].find((k) => !correctOf(root).includes(k)) as string;
    await verifyToEnd(root, { [wrong]: "correct" });
    expect(first(root).status).toBe("held");
    expect(first(root).reasons).toEqual(["ambiguous:multiple-correct", "verify:distractor-correct"]);
  });

  it("review の保留_検証が合格でも、検証役では解かない", async () => {
    const root = await ambiguousDraft(["review:question-published"]);
    await verifyToEnd(root);
    expect(first(root)).toMatchObject({ status: "held", reasons: ["review:question-published"] });
    expect(first(root).verification?.verdict).toBe("pass");
  });
});

describe("verify --import: 出力と依頼の照合", () => {
  async function requested() {
    const root = await withDraft();
    await runMain(root, ["verify", EXAM]);
    return { root, request: verifyRequests(root)[0] as VerifyRequest };
  }

  it("形が違う出力_取り込まず、上限まで出し直しを受け付け、超えると依頼を出さない", async () => {
    const { root, request } = await requested();
    for (let i = 0; i < baseConfig.verify.maxAttempts; i++) {
      writeVerifierOutput(root, request, { judgements: "壊れている" });
      const r = await runMain(root, ["verify", EXAM, "--import"]);
      expect(r.code).toBe(EXIT.checkFailed);
      expect(r.err).toContain(`検証の取り込みの停止: ${request.requestKey} output-invalid`);
      expect(existsSync(join(root, request.outputPath))).toBe(false);
    }
    rmSync(join(verifyDir(root, "requests"), `${request.requestKey}.json`));
    const again = await runMain(root, ["verify", EXAM]);
    expect(again.code).toBe(EXIT.checkFailed);
    expect(again.err).toContain("再試行の上限");
    expect(verifyRequests(root)).toEqual([]);
  });

  it("依頼と違う鍵・選択肢が欠けた出力_取り込まない", async () => {
    const { root, request } = await requested();
    writeVerifierOutput(root, request, { ...rederiveBody(request, correctOf(root)), draftId: "d-000000000000" });
    expect((await runMain(root, ["verify", EXAM, "--import"])).err).toContain("request-mismatch");
    const body = rederiveBody(request, correctOf(root));
    writeVerifierOutput(root, request, { judgements: body.judgements.slice(1) });
    expect((await runMain(root, ["verify", EXAM, "--import"])).err).toContain("output-invalid");
    expect(first(root).verification).toBeUndefined();
  });

  it("根拠の言い換えが節の本文の写し_取り込まない(本文の写しは持たない)", async () => {
    const { root, request } = await requested();
    const body = rederiveBody(request, correctOf(root));
    body.judgements[0] = {
      ...(body.judgements[0] as object),
      evidence: { heading: "quotas", summary: "A Widget Store holds up to 100 buckets per account in each region." },
    } as (typeof body.judgements)[number];
    writeVerifierOutput(root, request, body);
    expect((await runMain(root, ["verify", EXAM, "--import"])).err).toContain("output-invalid");
  });

  it("依頼のあとに検証役の定義が変わった_出力の形を見る前に、request-stale で依頼を捨てる(失敗に数えない)", async () => {
    const { root, request } = await requested();
    writeVerifierOutput(root, request, { judgements: "壊れている" });
    const path = join(root, ".claude", "agents", "question-verifier.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n- 追加した指示\n`);
    const r = await runMain(root, ["verify", EXAM, "--import"]);
    expect(r.err).toContain(`${request.requestKey} request-stale`);
    expect(r.err).not.toContain("output-invalid");
    expect(existsSync(join(verifyDir(root, "requests"), `${request.requestKey}.json`))).toBe(false);
    // 定義が変わると鍵が変わり、検証し直す
    await runMain(root, ["verify", EXAM]);
    expect(verifyRequests(root)[0]?.requestKey).not.toBe(request.requestKey);
  });

  it("依頼のあとに根拠の節が変わった_request-stale で捨てる", async () => {
    const { root, request } = await requested();
    writeVerifierOutput(root, request, rederiveBody(request, correctOf(root)));
    const factsFile = join(root, baseConfig.factsDir, "aws-aib-c01.json");
    const facts = JSON.parse(readFileSync(factsFile, "utf8"));
    for (const c of facts.cards) c.sources[0].anchor.heading = "security";
    writeFileSync(factsFile, JSON.stringify(facts));
    const r = await runMain(root, ["verify", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(first(root).verification).toBeUndefined();
  });

  it("依頼のあとに下書きの内容が変わった(設問文は同じ)_request-stale で捨てる", async () => {
    const { root, request } = await requested();
    writeVerifierOutput(root, request, rederiveBody(request, correctOf(root)));
    const file = draftsPath(root);
    const stored = readDrafts(file, EXAM);
    writeDrafts(file, {
      ...stored,
      drafts: stored.drafts.map((d) =>
        d.draft ? { ...d, draft: { ...d.draft, explanation: `${d.draft.explanation} 追記した解説です。` } } : d,
      ),
    });
    const r = await runMain(root, ["verify", EXAM, "--import"]);
    expect(r.err).toContain(`${request.requestKey} request-stale`);
    expect(first(root).verification).toBeUndefined();
  });

  it("出力がまだない依頼_待っていると報告するだけ", async () => {
    const { root, request } = await requested();
    const r = await runMain(root, ["verify", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toContain(`検証の出力なし: ${request.requestKey}`);
  });

  it("束の途中で止まり一部の依頼だけ出力がある_出力のある依頼だけを取り込み、残りの依頼は待ちのまま残って、あとから取り込める", async () => {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    stubAgent(root);
    expect((await runMain(root, ["draft", EXAM, "--import"])).code).toBe(EXIT.ok);
    await runMain(root, ["verify", EXAM]);
    const requests = verifyRequests(root).filter((q) => q.check === "rederive");
    expect(requests.length).toBeGreaterThanOrEqual(2);
    const [done, waiting] = requests as [VerifyRequest, VerifyRequest];
    const correctFor = (q: VerifyRequest) => {
      const d = records(root).find((x) => x.id === q.draftId)?.draft;
      return d !== null && d !== undefined && "correctAnswers" in d ? d.correctAnswers : [];
    };
    const byId = (id: string) => records(root).find((x) => x.id === id);
    writeVerifierOutput(root, done, rederiveBody(done, correctFor(done)));
    const partial = await runMain(root, ["verify", EXAM, "--import"]);
    expect(partial.code).toBe(EXIT.ok);
    expect(partial.err).toContain(`検証の出力なし: ${waiting.requestKey}`);
    expect(byId(done.draftId)?.verification?.checks.rederive?.result).toBe("pass");
    expect(byId(waiting.draftId)?.verification).toBeUndefined();
    const left = verifyRequests(root).map((q) => q.requestKey);
    expect(left).toContain(waiting.requestKey);
    expect(left).not.toContain(done.requestKey);
    // 残った依頼を、別の起動で処理した出力も、同じ形で取り込める
    writeVerifierOutput(root, waiting, rederiveBody(waiting, correctFor(waiting)));
    expect((await runMain(root, ["verify", EXAM, "--import"])).code).toBe(EXIT.ok);
    expect(byId(waiting.draftId)?.verification?.checks.rederive?.result).toBe("pass");
  });
});

describe("verify --bundles", () => {
  async function withRequests() {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    stubAgent(root);
    await runMain(root, ["draft", EXAM, "--import"]);
    await runMain(root, ["verify", EXAM]);
    return root;
  }
  const bundled = { verify: { ...baseConfig.verify, bundleSize: 2 } };
  const bundleLines = (out: string) =>
    out
      .split("\n")
      .filter((l) => l.startsWith("検証の束: "))
      .map((l) => l.slice("検証の束: ".length).split(" "));

  it("待っている依頼が束の大きさより多い_同じ check の依頼を大きさの数ずつ区切り、すべての依頼を 1 回ずつ挙げる。何も書かない", async () => {
    const root = await withRequests();
    const requests = verifyRequests(root);
    expect(requests.length).toBeGreaterThan(2);
    const before = readdirSync(verifyDir(root, "requests")).sort();
    const r = await runMain(root, ["verify", EXAM, "--bundles"], bundled);
    expect(r.code).toBe(EXIT.ok);
    const lines = bundleLines(r.out);
    expect(lines.length).toBe(Math.ceil(requests.length / 2));
    const listed = lines.flatMap(([check, count, _unit, ...files]) => {
      expect(check).toBe("rederive");
      expect(Number(count)).toBe(files.length);
      expect(files.length).toBeLessThanOrEqual(2);
      return files;
    });
    expect(listed.sort()).toEqual(
      requests.map((q) => join(baseConfig.workDir, "verify", "aws-aib-c01", "requests", `${q.requestKey}.json`)).sort(),
    );
    expect(readdirSync(verifyDir(root, "requests")).sort()).toEqual(before);
  });

  it("出力のある依頼と、再導出・解説の確認が混ざる_出力のある依頼は挙げず、check ごとに別の束にする", async () => {
    const root = await withRequests();
    const [first, second] = verifyRequests(root) as [VerifyRequest, VerifyRequest];
    const correctFor = (q: VerifyRequest) => {
      const d = records(root).find((x) => x.id === q.draftId)?.draft;
      return d !== null && d !== undefined && "correctAnswers" in d ? d.correctAnswers : [];
    };
    writeVerifierOutput(root, first, rederiveBody(first, correctFor(first)));
    await runMain(root, ["verify", EXAM, "--import"]);
    await runMain(root, ["verify", EXAM]);
    writeVerifierOutput(root, second, rederiveBody(second, correctFor(second)));
    const lines = bundleLines((await runMain(root, ["verify", EXAM, "--bundles"], bundled)).out);
    const checks = lines.map(([check]) => check);
    expect(checks).toContain("explanation");
    expect(checks.indexOf("explanation")).toBeGreaterThan(checks.lastIndexOf("rederive"));
    const listed = lines.flatMap(([, , , ...files]) => files);
    expect(listed.some((f) => f.includes(second.requestKey))).toBe(false);
    const explanation = verifyRequests(root).find((q) => q.check === "explanation") as VerifyRequest;
    const line = lines.find((l) => l.some((f) => f.includes(explanation.requestKey)));
    expect(line?.[0]).toBe("explanation");
  });

  it("読めない依頼のファイルがある_束に入れず、場所を入力の誤りとして報告して終了コード 2", async () => {
    const root = await withRequests();
    writeFileSync(join(verifyDir(root, "requests"), "0000000000000000.json"), "{");
    const r = await runMain(root, ["verify", EXAM, "--bundles"], bundled);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("入力の誤り: 読めない依頼");
    expect(r.out).not.toContain("0000000000000000");
  });

  it("出し直しの回数が上限ちょうどの依頼と、上限の 1 つ手前の依頼がある_上限の依頼だけを束に入れず、件数を報告する", async () => {
    const root = await withRequests();
    const [limit, below] = verifyRequests(root) as [VerifyRequest, VerifyRequest];
    writeFileSync(
      verifyDir(root, "state.json"),
      JSON.stringify({
        [limit.requestKey]: baseConfig.verify.maxAttempts,
        [below.requestKey]: baseConfig.verify.maxAttempts - 1,
      }),
    );
    const r = await runMain(root, ["verify", EXAM, "--bundles"], bundled);
    expect(r.code).toBe(EXIT.ok);
    const listed = bundleLines(r.out).flatMap(([, , , ...files]) => files);
    expect(listed.some((f) => f.includes(limit.requestKey))).toBe(false);
    expect(listed.some((f) => f.includes(below.requestKey))).toBe(true);
    expect(r.out + r.err).toContain("出し直しの回数が上限に達した依頼 1 件");
  });

  it("依頼のあとに検証役の定義が変わった依頼がある_束に入れず、件数を報告する", async () => {
    const root = await withRequests();
    const [old] = verifyRequests(root) as [VerifyRequest];
    const path = verifyDir(root, "requests", `${old.requestKey}.json`);
    const request = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...request, agent: { ...request.agent, definitionHash: "0".repeat(64) } }));
    const r = await runMain(root, ["verify", EXAM, "--bundles"], bundled);
    expect(r.code).toBe(EXIT.ok);
    const listed = bundleLines(r.out).flatMap(([, , , ...files]) => files);
    expect(listed.some((f) => f.includes(old.requestKey))).toBe(false);
    expect(r.out + r.err).toContain("検証役の定義が依頼のあとに変わった依頼 1 件");
  });

  it("出し直しの回数が上限に達し、依頼のあとに検証役の定義も変わった依頼がある_定義が変わった依頼として数え、上限の件数には数えない", async () => {
    const root = await withRequests();
    const [both] = verifyRequests(root) as [VerifyRequest];
    writeFileSync(verifyDir(root, "state.json"), JSON.stringify({ [both.requestKey]: baseConfig.verify.maxAttempts }));
    const path = verifyDir(root, "requests", `${both.requestKey}.json`);
    const request = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...request, agent: { ...request.agent, definitionHash: "0".repeat(64) } }));
    const r = await runMain(root, ["verify", EXAM, "--bundles"], bundled);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out + r.err).toContain("検証役の定義が依頼のあとに変わった依頼 1 件");
    expect(r.out + r.err).not.toContain("出し直しの回数が上限に達した依頼");
  });
});

describe("判定の優先順位と理由コード", () => {
  it("重い判定を採る_不採用、保留、合格の順", () => {
    expect(heavier("pass", "hold")).toBe("hold");
    expect(heavier("hold", "reject")).toBe("reject");
    expect(heavier("reject", "pass")).toBe("reject");
    expect(heavier("pass", "pass")).toBe("pass");
  });

  it("再導出の判定_宣言との食い違いを区別し、複数の理由を重複なしで残す", () => {
    const j = (key: string, judgement: "correct" | "incorrect" | "unknown", evidenceFound = true) => ({
      key,
      judgement,
      evidenceFound,
    });
    expect(judgeRederive(["A"], [j("A", "correct"), j("B", "incorrect")]).codes).toEqual([]);
    expect(judgeRederive(["A"], [j("A", "incorrect"), j("B", "incorrect")]).codes).toEqual(["answer-mismatch"]);
    expect(judgeRederive(["A"], [j("A", "correct"), j("B", "correct")]).codes).toEqual(["distractor-correct"]);
    expect(judgeRederive(["A"], [j("A", "correct"), j("B", "unknown")]).codes).toEqual(["undetermined"]);
    expect(judgeRederive(["A"], [j("A", "correct", false), j("B", "incorrect")]).codes).toEqual(["evidence-not-found"]);
    expect(
      judgeRederive(["A"], [j("A", "incorrect"), j("B", "correct"), j("C", "unknown"), j("D", "incorrect", false)])
        .codes,
    ).toEqual(["answer-mismatch", "distractor-correct", "evidence-not-found", "undetermined"]);
  });

  it("未定義の理由コード_記録のスキーマが拒否する。定義済みのコードは、すべて区別されている", () => {
    const base = { verdict: "hold", reasons: [], findings: [], checks: {} };
    expect(
      VerificationSchema.safeParse({ ...base, findings: [{ code: "no-such-code", where: "explanation" }] }).success,
    ).toBe(false);
    expect(
      VerificationSchema.safeParse({ ...base, findings: [{ code: "overclaim", where: "somewhere" }] }).success,
    ).toBe(false);
    expect(VerificationSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(new Set(VERIFY_CODES).size).toBe(VERIFY_CODES.length);
  });

  it("書き出しの条件_検証の合格、または人が承認した検証の保留だけが通る", () => {
    const v = (verdict: "pass" | "hold" | "reject" | null) => ({ verdict, reasons: [], findings: [], checks: {} });
    expect(isVerified(undefined, "approve")).toBe(false);
    expect(isVerified(v("pass"), undefined)).toBe(true);
    expect(isVerified(v(null), "approve")).toBe(false);
    expect(isVerified(v("hold"), undefined)).toBe(false);
    expect(isVerified(v("hold"), "approve")).toBe(true);
    expect(isVerified(v("reject"), "approve")).toBe(false);
  });
});
