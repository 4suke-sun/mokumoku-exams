import { describe, expect, it } from "vitest";
import { validateCodeDrillData } from "./validate.ts";

const context = { exams: new Map([["EX-SMP-XX", { domains: new Set(["domain1", "domain2"]), idPrefix: "SAMPLE" }]]) };

const outcome = (over: Record<string, unknown> = {}) => ({ kind: "error", text: "構文のエラーになります。", ...over });
const problem = (over: Record<string, unknown> = {}) => ({
  id: "SAMPLE-CD-0001",
  domain: "domain1",
  language: "sql",
  title: "行を絞る",
  prompt: "`sales` から `amount` が 100 を超える行を選びます。",
  template: "SELECT * FROM sales {{1}} amount {{2}} 100",
  blanks: [{ answer: "WHERE" }, { answer: ">" }],
  distractors: [
    { text: "HAVING", blank: 1, outcome: outcome() },
    { text: ">=", blank: 2, outcome: outcome({ kind: "different-result", text: "100 の行も入ります。" }) },
  ],
  solutions: ["SELECT * FROM sales WHERE amount > 100"],
  result: { text: "`amount` が 100 を超える行だけが返ります。" },
  explanation: "`WHERE` で行を絞ります。",
  references: [{ title: "出典", url: "https://docs.databricks.com/" }],
  status: "verified",
  ...over,
});
const file = (problems: unknown[] = [problem()], examCode = "EX-SMP-XX") => ({ examCode, problems });
const run = (data: unknown, name = "code-drill.ex-smp-xx.json") => validateCodeDrillData([{ name, data }], context);

describe("validateCodeDrillData", () => {
  it("正しいデータ_指摘なし", () => {
    expect(run(file())).toEqual([]);
  });

  it("ファイルがない_指摘なし(コードドリルは任意)", () => {
    expect(validateCodeDrillData([], context)).toEqual([]);
  });

  it("ファイル名・examCode・公開中でない資格_それぞれ報告する", () => {
    expect(run(file(), "code-drill.json")).toEqual([
      "code-drill.json: ファイル名が code-drill.<コード(英小文字と数字)>.json の形ではありません",
    ]);
    expect(run(file(undefined, "EX-SM2-XX"))).toEqual([
      "code-drill.ex-smp-xx.json: examCode がファイル名のコードと一致しません",
    ]);
    expect(run(file(undefined, "EX-OTH-XX"), "code-drill.ex-oth-xx.json")).toEqual([
      "code-drill.ex-oth-xx.json: 公開中の資格のコードドリルではありません",
    ]);
  });

  it("分野と問題 ID の接頭辞が資格マスタにない_場所と種類だけを報告する", () => {
    expect(run(file([problem({ domain: "domain9", id: "OTHER-CD-0001" })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].domain: 資格マスタの分野にない分野です",
      "code-drill.ex-smp-xx.json: problems[0].id: 問題 ID の接頭辞が資格マスタと違います",
    ]);
  });

  it("穴に正解を入れたコードが正解の全体と違う_指摘する", () => {
    expect(run(file([problem({ solutions: ["SELECT * FROM sales WHERE amount >= 100"] })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].solutions[0]: 穴に正解を入れたコードと一致しません",
    ]);
  });

  it("穴の番号が連番でない・穴の数と違う_指摘する", () => {
    expect(run(file([problem({ template: "SELECT * FROM sales {{2}} amount {{1}} 100" })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].template: 穴の番号が 1 からの連番で、穴の数と一致しません",
    ]);
    expect(run(file([problem({ template: "SELECT * FROM sales {{1}} amount > 100" })]))).toHaveLength(1);
  });

  it("誤りの断片がない穴を指す・その穴の正解と同じ_指摘する", () => {
    const bad = [
      { text: "HAVING", blank: 3, outcome: outcome() },
      { text: "WHERE", blank: 1, outcome: outcome() },
    ];
    expect(run(file([problem({ distractors: bad })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].distractors[0].blank: ない穴の番号です",
      "code-drill.ex-smp-xx.json: problems[0].distractors[1].text: その穴の正解と同じ断片です",
    ]);
  });

  it("断片の数が穴の数 + 2 より少ない_指摘する", () => {
    expect(run(file([problem({ distractors: [{ text: "HAVING", blank: 1, outcome: outcome() }] })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].distractors: 断片の数が、穴の数 + 2 以上、12 以下ではありません",
    ]);
  });

  it("別解が正規化すると正解と同じ・よくある誤りが正解と同じ_指摘する", () => {
    const same = "select *\nfrom sales where amount>100;";
    expect(run(file([problem({ solutions: ["SELECT * FROM sales WHERE amount > 100", same] })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].solutions[1]: 別解が、正解か別の別解と同じです",
    ]);
    expect(run(file([problem({ mistakes: [{ code: same, outcome: outcome() }] })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].mistakes[0].code: よくある誤りが、正解か別解と同じです",
    ]);
  });

  it("問題 ID の重複・形の誤り・未知の項目・本文の URL_指摘する", () => {
    expect(run(file([problem(), problem()]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[1].id: 問題 ID が重複しています",
    ]);
    expect(run(file([problem({ id: "SAMPLE-0001" })]))).toHaveLength(1);
    expect(run(file([problem({ extra: 1 })]))).toHaveLength(1);
    expect(run(file([problem({ explanation: "解説 https://example.com/" })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].explanation: 本文に URL が含まれています",
    ]);
  });

  it("実行するとどうなるかの種類が決まった値でない・出典のドメインが許可の一覧にない_指摘する", () => {
    expect(
      run(
        file([
          problem({
            distractors: [{ text: "HAVING", blank: 1, outcome: outcome({ kind: "boom" }) }, problem().distractors[1]],
          }),
        ]),
      ),
    ).toHaveLength(1);
    expect(run(file([problem({ references: [{ title: "出典", url: "https://learning.example.com/" }] })]))).toEqual([
      "code-drill.ex-smp-xx.json: problems[0].references[0].url: 出典に許していないドメインの URL です",
    ]);
  });
});
