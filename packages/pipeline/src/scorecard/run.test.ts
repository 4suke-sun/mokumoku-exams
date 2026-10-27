import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { EXIT } from "../exit-codes.ts";
import { DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import { main } from "../main.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const configPath = resolve(import.meta.dirname, "../../pipeline.config.json");

async function run(argv: string[], root = repoRoot, config = configPath) {
  let out = "";
  let err = "";
  const code = await main({
    argv,
    env: {},
    output: {
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    },
    configPath: config,
    rootDir: root,
  });
  return { code, out, err };
}

describe("score コマンド", () => {
  it("帯のある資格_問題ごとと束の結果を標準出力に出し_終了コード 0 で終わる", async () => {
    const r = await run(["score", "AWS-CLF-C02"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("点数票: AWS-CLF-C02 選択式");
    expect(r.out).toContain("問題ごと(80 点で合格)");
    expect(r.out).toContain("束(70 点で合格)");
    expect(r.err).toBe("");
  });

  it("出力_公開している問題の設問文や選択肢の本文を含まない", async () => {
    const data = JSON.parse(readFileSync(resolve(repoRoot, "data/questions.aws-clf-c02.json"), "utf8"));
    const r = await run(["score", "AWS-CLF-C02"]);
    for (const q of data.questions.slice(0, 20)) {
      expect(r.out).not.toContain(q.questionText);
      for (const c of q.choices ?? []) expect(r.out).not.toContain(c.text);
    }
  });

  it("点数票の帯がない資格_入力の誤りとして終わる", async () => {
    const r = await run(["score", "EX-SMP-XX"]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("点数票の帯がない資格");
  });

  it("資格コードの指定がない_入力の誤りとして終わる", async () => {
    const r = await run(["score"]);
    expect(r.code).toBe(EXIT.inputError);
  });

  it("資格マスタにない資格コード_入力の誤りとして終わる", async () => {
    const r = await run(["score", "ZZZ-XXX-01"]);
    expect(r.code).toBe(EXIT.inputError);
  });
});

describe("score コマンドの束のサービスの分布", () => {
  const CODE = "AWS-AIB-C01";
  const baseConfig = JSON.parse(readFileSync(configPath, "utf8"));

  /** 選択式の問題を 20 問置く。10 問に Lambda と DynamoDB、10 問に Lambda だけを出す */
  function setup(options: { list: boolean; targets?: object }) {
    const root = mkdtempSync(join(tmpdir(), "pipeline-score-"));
    mkdirSync(join(root, "data"));
    cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
    const questions = Array.from({ length: 20 }, (_, i) => ({
      questionId: `AIB-${String(i + 1).padStart(4, "0")}`,
      examCode: CODE,
      domain: "domain1",
      questionType: "single",
      difficulty: "medium",
      questionText: i < 10 ? `Lambda から DynamoDB に書く架空の設問 ${i}` : `Lambda の架空の設問 ${i}`,
      choices: [
        { key: "A", text: "選択肢 A" },
        { key: "B", text: "選択肢 B" },
      ],
      correctAnswers: ["A"],
      explanation: "架空の解説",
    }));
    writeFileSync(join(root, "data/questions.aws-aib-c01.json"), JSON.stringify({ examCode: CODE, questions }));
    const config = {
      ...baseConfig,
      plan: {
        ...baseConfig.plan,
        overrides: options.targets === undefined ? {} : { [CODE]: { services: options.targets } },
      },
    };
    writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(config));
    writeLedger(ledgerPath(join(root, baseConfig.ledgerDir), CODE), {
      ...emptyLedger(CODE),
      guide: {
        sourceUrl: DOC_URL,
        contentHash: DOC_HASH,
        pages: [],
        importedAt: "2026-10-25",
        ...(options.list ? { services: ["AWS Lambda", "Amazon DynamoDB", "AWS Step Functions"] } : {}),
        domains: [{ code: "domain1", name: "a", weight: 1, scope: [] }],
      },
    });
    return root;
  }
  const runIn = (root: string) => run(["score", CODE], root, join(root, "pipeline.config.json"));

  it("一覧がある_出るサービスの数、サービスが出る設問と 2 つ以上出る設問の割合、多い順を出す", async () => {
    const r = await runIn(setup({ list: true }));
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain(
      "束のサービス: 一覧 3 件のうち出る 2 件、サービスが出る設問 100%、2 つ以上のサービスが出る設問 50%、多い順 AWS Lambda 100%、Amazon DynamoDB 50%",
    );
    expect(r.out).not.toContain("束の警告");
  });

  it("目安から外れる_サービスの偏りと、2 つ以上のサービスが出る設問の不足を警告し、終了コードは 0", async () => {
    const r = await runIn(
      setup({ list: true, targets: { minPerService: 1, maxShare: 0.6, minMultiServiceShare: 0.6 } }),
    );
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("束の警告: サービスの偏り AWS Lambda 100%(上限 60%)");
    expect(r.out).not.toContain("束の警告: サービスの偏り Amazon DynamoDB");
    expect(r.out).toContain("束の警告: 2 つ以上のサービスが出る設問 50%(下限 60%)");
  });

  it("一覧がない_測らない旨だけを出し、終了コードは 0", async () => {
    const r = await runIn(setup({ list: false, targets: { minPerService: 1, maxShare: 0.6 } }));
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("束のサービス: 試験ガイドの対象サービスの一覧がないので測らない");
  });
});

describe("score コマンドの範囲の検査", () => {
  const CODE = "AWS-AIB-C01";
  const baseConfig = JSON.parse(readFileSync(configPath, "utf8"));

  /** 20 問: 設問文に対象外、誤答だけに対象外、一覧にない名前が 1 問ずつ。残りは何も出ない */
  function setup(guide: { services?: string[]; excludedServices?: string[] } | null) {
    const root = mkdtempSync(join(tmpdir(), "pipeline-score-scope-"));
    mkdirSync(join(root, "data"));
    cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
    const make = (n: number, stem: string, a: string) => ({
      questionId: `AIB-${String(n).padStart(4, "0")}`,
      examCode: CODE,
      domain: "domain1",
      questionType: "single",
      difficulty: "medium",
      questionText: stem,
      choices: [
        { key: "A", text: a },
        { key: "B", text: "選択肢 B" },
      ],
      correctAnswers: ["B"],
      explanation: "架空の解説",
    });
    const questions = [
      make(1, "Amazon Kinesis を使う架空の設問", "選択肢 A"),
      make(2, "架空の設問", "Amazon Kinesis"),
      make(3, "AWS Glue を使う架空の設問", "選択肢 A"),
      // 束の採点は 20 問から。残りは何も出ない問題
      ...Array.from({ length: 17 }, (_, i) => make(i + 4, `AWS Lambda を使う架空の設問 ${i}`, "選択肢 A")),
    ];
    writeFileSync(join(root, "data/questions.aws-aib-c01.json"), JSON.stringify({ examCode: CODE, questions }));
    writeFileSync(join(root, "pipeline.config.json"), JSON.stringify(baseConfig));
    writeLedger(ledgerPath(join(root, baseConfig.ledgerDir), CODE), {
      ...emptyLedger(CODE),
      guide:
        guide === null
          ? null
          : {
              sourceUrl: DOC_URL,
              contentHash: DOC_HASH,
              pages: [],
              importedAt: "2026-10-25",
              ...guide,
              domains: [{ code: "domain1", name: "a", weight: 1, scope: [] }],
            },
    });
    return root;
  }
  const runIn = (root: string) => run(["score", CODE], root, join(root, "pipeline.config.json"));

  it("一覧がある_該当する問題の ID と件数だけを出し(名前と本文は出さない)_終了コードは 0", async () => {
    const r = await runIn(setup({ services: ["AWS Lambda"], excludedServices: ["Amazon Kinesis"] }));
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain(
      "範囲の検査: 対象外のサービスが設問文・正答に出る 1 問(AIB-0001)、誤答だけに出る 1 問(AIB-0002)、一覧にないサービスらしい名前が出る 1 問(AIB-0003)",
    );
    expect(r.out).not.toContain("Kinesis");
    expect(r.out).not.toContain("Glue");
  });

  it("対象サービスの一覧がなく対象外の一覧だけがある_対象外の検査だけをする", async () => {
    const r = await runIn(setup({ excludedServices: ["Amazon Kinesis"] }));
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain(
      "設問文・正答に出る 1 問(AIB-0001)、誤答だけに出る 1 問(AIB-0002)、一覧にないサービスらしい名前が出る (対象サービスの一覧がないので測らない)",
    );
    expect(r.out).toContain("束のサービス: 試験ガイドの対象サービスの一覧がないので測らない");
  });

  it("一覧がない_範囲の検査を出さない", async () => {
    const r = await runIn(setup(null));
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).not.toContain("範囲の検査");
  });
});
