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
  workPath,
  writeOutput,
} from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { type VerifyRequest, VerifyRequestSchema } from "./request.ts";
import { judgeRederive } from "./run.ts";
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
