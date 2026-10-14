import { describe, expect, it } from "vitest";
import {
  checkEnvContract,
  extractAppEnvReads,
  extractCdkEnvNames,
  LAMBDA_PROVIDED,
  OPTIONAL,
} from "./env-contract-check.ts";

const names = (reads: { name: string }[]) => reads.map((r) => r.name);

describe("extractAppEnvReads", () => {
  it("process_envとenvの参照_名前と場所を取り出す", () => {
    const text = 'const a = process.env.ALPHA_ONE;\nconst b = env.BETA_TWO;\nconst c = env["GAMMA_THREE"];';
    expect(extractAppEnvReads([{ file: "a.ts", text }])).toEqual([
      { name: "ALPHA_ONE", file: "a.ts", line: 1 },
      { name: "BETA_TWO", file: "a.ts", line: 2 },
      { name: "GAMMA_THREE", file: "a.ts", line: 3 },
    ]);
  });

  it("分割代入_別名とそのままの名前を取り出す", () => {
    const text = "const { ALPHA_ONE: a, BETA_TWO, GAMMA_THREE = 'x' } = env;\nconst { DELTA_FOUR: d } = process.env;";
    expect(names(extractAppEnvReads([{ file: "a.ts", text }]))).toEqual([
      "ALPHA_ONE",
      "BETA_TWO",
      "GAMMA_THREE",
      "DELTA_FOUR",
    ]);
  });

  it("動的な参照と別名への代入_検査の限界として取り出さない", () => {
    const text = "const key = 'ALPHA_ONE';\nconst a = process.env[key];\nconst e = process.env;\nconst b = e.BETA_TWO;";
    expect(extractAppEnvReads([{ file: "a.ts", text }])).toEqual([]);
  });

  it("env以外のオブジェクトと小文字の名前_取り出さない", () => {
    const text = "const a = config.ALPHA_ONE;\nconst b = process.env.lower;\nconst c = myenv.BETA_TWO;";
    expect(extractAppEnvReads([{ file: "a.ts", text }])).toEqual([]);
  });
});

describe("extractCdkEnvNames", () => {
  const web = {
    file: "web.ts",
    text: `new Function(this, "F", {
      environment: {
        ALPHA_ONE: "x",
        // 設定したときだけ渡す
        ...(config.siteUrl ? { BETA_TWO: config.siteUrl } : {}),
        ...(config.push ? helperEnv(config.push) : {}),
      },
      timeout: 1,
    });`,
  };
  const other = {
    file: "push.ts",
    text: "export function helperEnv(p: P): Record<string, string> {\n  return { GAMMA_THREE: p.a, DELTA_FOUR: p.b };\n}\nconst OUTSIDE_FIVE: 1;",
  };

  it("environmentのブロック_直接の名前と条件つきの名前と関数の中の名前を集める", () => {
    expect([...extractCdkEnvNames(web, [other])].sort()).toEqual([
      "ALPHA_ONE",
      "BETA_TWO",
      "DELTA_FOUR",
      "GAMMA_THREE",
    ]);
  });

  it("environmentのブロックの外の名前_集めない", () => {
    expect(extractCdkEnvNames(web, [other]).has("OUTSIDE_FIVE")).toBe(false);
  });

  it("ブロックの中の関数が定義元にない_その関数の名前は集めない", () => {
    const text = "const x = { environment: { ALPHA_ONE: 'a', ...unknownFn() } };";
    expect([...extractCdkEnvNames({ file: "web.ts", text }, [])]).toEqual(["ALPHA_ONE"]);
  });

  it("environmentがない_空にする", () => {
    expect(extractCdkEnvNames({ file: "web.ts", text: "const a = 1;" }, []).size).toBe(0);
  });
});

describe("checkEnvContract", () => {
  const read = (name: string) => ({ name, file: "a.ts", line: 3 });

  it("すべて渡される_エラーなし", () => {
    const reads = [read("ALPHA_ONE"), ...LAMBDA_PROVIDED.map(read), ...Object.keys(OPTIONAL).map(read)];
    expect(checkEnvContract(reads, new Set(["ALPHA_ONE"]))).toEqual([]);
  });

  it("渡されない名前がある_場所と名前だけを報告する", () => {
    const errors = checkEnvContract(
      [read("ALPHA_ONE"), read("BETA_TWO"), ...LAMBDA_PROVIDED.map(read), ...Object.keys(OPTIONAL).map(read)],
      new Set(["ALPHA_ONE"]),
    );
    expect(errors).toEqual(["a.ts:3: アプリが読む環境変数 BETA_TWO が、CDK から Lambda へ渡されない"]);
  });

  it("除外の一覧の名前_渡されなくてもエラーにしない", () => {
    expect(checkEnvContract([...LAMBDA_PROVIDED.map(read), ...Object.keys(OPTIONAL).map(read)], new Set())).toEqual([]);
  });

  it("除外の一覧にあるがアプリが読まない名前_一覧から消すよう報告する", () => {
    const errors = checkEnvContract([], new Set());
    expect(errors).toHaveLength(LAMBDA_PROVIDED.length + Object.keys(OPTIONAL).length);
    expect(errors[0]).toContain("除外の一覧");
  });
});
