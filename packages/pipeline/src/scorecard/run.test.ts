import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "../exit-codes.ts";
import { main } from "../main.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const configPath = resolve(import.meta.dirname, "../../pipeline.config.json");

async function run(argv: string[]) {
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
    configPath,
    rootDir: repoRoot,
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
    const r = await run(["score", "AWS-AIB-C01"]);
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
