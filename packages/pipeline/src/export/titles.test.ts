import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger, serializeLedger } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { fillReferenceTitles, runFillTitles } from "./titles.ts";

const A = "https://docs.aws.amazon.com/a.html";
const B = "https://docs.aws.amazon.com/b.html";
const C = "https://docs.aws.amazon.com/c.html";
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));

describe("出典の題を足す", () => {
  it("同じ URL の題がデータにある_その題を使い、台帳の題より先にする", () => {
    const questions = [{ references: [{ url: A, title: "データの題" }] }, { references: [{ url: A }] }];
    const result = fillReferenceTitles(questions, new Map([[A, "台帳の題"]]));
    expect(result).toEqual({ added: 1, missing: [] });
    expect(questions[1]?.references).toEqual([{ url: A, title: "データの題" }]);
  });

  it("データに題がない_台帳の題を使い、同じ URL には同じ題を付ける", () => {
    const questions = [{ references: [{ url: B }] }, { references: [{ url: B }, { url: C }] }];
    const result = fillReferenceTitles(questions, new Map([[B, "B の題"]]));
    expect(result).toEqual({ added: 2, missing: [C] });
    expect(questions[0]?.references).toEqual([{ url: B, title: "B の題" }]);
    expect(questions[1]?.references).toEqual([{ url: B, title: "B の題" }, { url: C }]);
  });

  it("題が契約に合わない_足さず、題が取れない URL に数える", () => {
    const questions = [{ references: [{ url: A }] }];
    const result = fillReferenceTitles(questions, new Map([[A, "題 https://example.com/x を含む"]]));
    expect(result).toEqual({ added: 0, missing: [A] });
    expect(questions[0]?.references).toEqual([{ url: A }]);
  });

  it("出典のない問題_そのままにする", () => {
    const questions = [{}, { references: [] }];
    expect(fillReferenceTitles(questions, new Map())).toEqual({ added: 0, missing: [] });
  });
});

describe("export --titles", () => {
  const repoData = resolve(import.meta.dirname, "../../../../data");
  // 実際のデータの形に合う問題の 1 つ目の出典から題を外し、台帳にその題を置く(データの検査を通す)
  function setup(corrupt = false) {
    const root = mkdtempSync(join(tmpdir(), "pipeline-titles-"));
    mkdirSync(join(root, "data"));
    mkdirSync(join(root, config.ledgerDir), { recursive: true });
    copyFileSync(join(repoData, "exams.json"), join(root, "data/exams.json"));
    for (const name of readdirSync(repoData).filter((f) => /^questions\..+\.json$/.test(f))) {
      copyFileSync(join(repoData, name), join(root, "data", name));
    }
    const file = join(root, "data/questions.aws-aib-c01.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    const ref = data.questions[0].references[0] as { url: string; title?: string };
    const title = ref.title as string;
    delete ref.title;
    if (corrupt) delete data.questions[1].questionText;
    writeFileSync(file, JSON.stringify(data));
    const ledger = { ...emptyLedger("AWS-AIB-C01"), sources: [entry({ url: ref.url, title })] };
    writeFileSync(join(root, config.ledgerDir, "aws-aib-c01.json"), serializeLedger(ledger));
    return { root, file, url: ref.url, title };
  }
  const run = (root: string, dryRun: boolean) => {
    let out = "";
    const code = runFillTitles({
      config,
      rootDir: root,
      examCode: "AWS-AIB-C01",
      dryRun,
      output: { out: (t) => (out += t), err: (t) => (out += t) },
    });
    return { code, out };
  };

  it("題のない出典_台帳の題を足し、データの検査を通る", () => {
    const { root, file, url, title } = setup();
    const r = run(root, false);
    const data = JSON.parse(readFileSync(file, "utf8"));
    expect(data.questions[0].references[0]).toEqual({ url, title });
    expect(r.code).toBe(EXIT.ok);
  });

  it("題が台帳にない出典が残る_報告して、失敗で終わる", () => {
    const { root, file, url } = setup();
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.questions[0].references.push({ url: "https://docs.aws.amazon.com/not-in-ledger.html" });
    writeFileSync(file, JSON.stringify(data));
    const r = run(root, false);
    expect(r.out).toContain("題が取れない出典: https://docs.aws.amazon.com/not-in-ledger.html");
    expect(r.code).toBe(EXIT.checkFailed);
    expect(JSON.parse(readFileSync(file, "utf8")).questions[0].references[0].url).toBe(url);
  });

  it("データの検査に落ちる_書き込みを取り消して失敗で終わる", () => {
    const { root, file } = setup(true);
    const before = readFileSync(file, "utf8");
    const r = run(root, false);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.out).toContain("データの検査の失敗");
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("ドライラン_ファイルを書き換えない", () => {
    const { root, file } = setup();
    const before = readFileSync(file, "utf8");
    const r = run(root, true);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(r.out).toContain("書き込みをしない(dry-run)");
  });
});
