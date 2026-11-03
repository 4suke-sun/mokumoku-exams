import { describe, expect, it } from "vitest";
import { validateNotebookData } from "./validate.ts";

const context = { domains: new Map([["EX-SMP-XX", new Set(["domain1", "domain2"])]]) };

const unit = (over: Record<string, unknown> = {}) => ({
  id: "domain1-1",
  domain: "domain1",
  order: 1,
  title: "中分類 1",
  status: "verified",
  ...over,
});
const choiceA = { key: "A", text: "選択肢 A です。", reason: "A の理由です。" };
const choiceB = { key: "B", text: "選択肢 B です。", reason: "B の理由です。" };
const check = (over: Record<string, unknown> = {}) => ({
  question: "どちらが正しいですか。",
  choices: [choiceA, choiceB],
  correct: "A",
  ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
  id: "term-one",
  unit: "domain1-1",
  order: 1,
  term: "用語 1",
  oneLine: "用語 1 は、決まった場所にデータを置くしくみ。",
  keyPhrase: "決まった場所にデータを置く",
  body: "解説です。`CREATE TABLE` を使います。",
  checks: [check()],
  references: [{ title: "出典", url: "https://docs.databricks.com/" }],
  status: "verified",
  ...over,
});
const notebook = (units: unknown[] = [unit()], entries: unknown[] = [entry()], examCode = "EX-SMP-XX") => ({
  examCode,
  units,
  entries,
});
const files = (data: unknown = notebook(), name = "notebook.ex-smp-xx.json") => [{ name, data }];
const run = (data: unknown) => validateNotebookData(files(data), context);

describe("validateNotebookData", () => {
  it("正しいデータ_指摘なし", () => {
    const data = notebook(
      [unit(), unit({ id: "domain1-2", order: 2, intro: "導入です。" }), unit({ id: "domain2-1", domain: "domain2" })],
      [
        entry({ related: ["term-two"] }),
        entry({ id: "term-two", order: 2, keyPhrase: undefined, status: "unverified", examAngle: "押さえる点です。" }),
      ],
    );
    expect(run(data)).toEqual([]);
  });

  it("ノートのファイルがない_指摘なし(体系ノートは任意)", () => {
    expect(validateNotebookData([], context)).toEqual([]);
  });

  it("見出しのない中分類だけ_指摘なし", () => {
    expect(run(notebook([unit()], []))).toEqual([]);
  });

  it("ファイル名の形が違う・examCode が違う・公開中でない資格_それぞれ報告する", () => {
    expect(validateNotebookData(files(notebook(), "notebook.json"), context)).toEqual([
      "notebook.json: ファイル名が notebook.<コード(英小文字と数字)>.json の形ではありません",
    ]);
    expect(run(notebook(undefined, undefined, "EX-SM2-XX"))).toEqual([
      "notebook.ex-smp-xx.json: examCode がファイル名のコードと一致しません",
    ]);
    expect(
      validateNotebookData(files(notebook(undefined, undefined, "EX-SM2-XX"), "notebook.ex-sm2-xx.json"), context),
    ).toEqual(["notebook.ex-sm2-xx.json: 公開中の資格の体系ノートではありません"]);
  });

  it("資格マスタにない分野_場所と種類だけを報告する", () => {
    const data = notebook([unit({ id: "domain9-1", domain: "domain9" })], []);
    expect(run(data)).toEqual(["notebook.ex-smp-xx.json: units[0].domain: 資格マスタの分野にない分野です"]);
  });

  it("中分類の ID の重複・分野と並び順に合わない ID_それぞれ報告する", () => {
    expect(run(notebook([unit(), unit()], []))).toEqual([
      "notebook.ex-smp-xx.json: units[1].id: 中分類の ID が重複しています",
    ]);
    expect(run(notebook([unit({ id: "domain1-2" })], []))).toEqual([
      "notebook.ex-smp-xx.json: units[0].id: 中分類の ID が分野のコードと並び順に合いません",
    ]);
  });

  it("見出しの ID の重複・中分類の中の並び順の重複_それぞれ報告する", () => {
    expect(run(notebook([unit()], [entry(), entry({ order: 2 })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[1].id: 見出しの ID が重複しています",
    ]);
    expect(run(notebook([unit()], [entry(), entry({ id: "term-two" })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[1].order: 中分類の中の並び順が重複しています",
    ]);
  });

  it("ファイルにない中分類・ファイルにない関連する見出し_場所と種類だけを報告する", () => {
    expect(run(notebook([unit()], [entry({ unit: "domain1-9" })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].unit: ファイルにない中分類です",
    ]);
    expect(run(notebook([unit()], [entry({ related: ["term-none"] })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].related[0]: ファイルにない見出しです",
    ]);
    expect(run(notebook([unit()], [entry({ related: ["term-one"] })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].related[0]: 自分自身は関連する見出しにできません",
    ]);
  });

  it("出典のドメインが許可の一覧にない・出典がない_指摘する", () => {
    expect(run(notebook([unit()], [entry({ references: [{ url: "https://learning.example.com/" }] })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].references[0].url: 出典に許していないドメインの URL です",
    ]);
    expect(run(notebook([unit()], [entry({ references: [] })]))).toHaveLength(1);
    const { references: _omit, ...noReferences } = entry();
    expect(run(notebook([unit()], [noReferences]))).toHaveLength(1);
  });

  it("確認の問いがない_指摘する", () => {
    expect(run(notebook([unit()], [entry({ checks: [] })]))).toHaveLength(1);
  });

  it("確認の問いの選択肢が 2 つでない_指摘する", () => {
    const a = choiceA;
    expect(run(notebook([unit()], [entry({ checks: [check({ choices: [a] })] })]))).toHaveLength(1);
    const c = { key: "C", text: "選択肢 C です。", reason: "C の理由です。" };
    expect(run(notebook([unit()], [entry({ checks: [check({ choices: [...check().choices, c] })] })]))).toHaveLength(1);
  });

  it("選択肢のキーが A・B の順でない_場所と種類だけを報告する", () => {
    const [a, b] = [choiceA, choiceB];
    expect(run(notebook([unit()], [entry({ checks: [check({ choices: [b, a] })] })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].checks[0].choices[0].key: 選択肢のキーは A・B の順にします",
      "notebook.ex-smp-xx.json: entries[0].checks[0].choices[1].key: 選択肢のキーは A・B の順にします",
    ]);
  });

  it("正解のキーが A・B のどちらでもない_指摘する", () => {
    expect(run(notebook([unit()], [entry({ checks: [check({ correct: "C" })] })]))).toHaveLength(1);
  });

  it("選択肢に理由がない_指摘する", () => {
    const { reason: _omit, ...noReason } = choiceB;
    expect(run(notebook([unit()], [entry({ checks: [check({ choices: [choiceA, noReason] })] })]))).toHaveLength(1);
  });

  it("2 つの選択肢の文が同じ_場所と種類だけを報告する", () => {
    expect(
      run(notebook([unit()], [entry({ checks: [check({ choices: [choiceA, { ...choiceB, text: choiceA.text }] })] })])),
    ).toEqual(["notebook.ex-smp-xx.json: entries[0].checks[0].choices[1].text: 2 つの選択肢の文が同じです"]);
  });

  it("旧い形の確認の問い(答えと理由)_指摘する", () => {
    const old = { question: "問いです。", answer: "答えです。", reason: "理由です。" };
    expect(run(notebook([unit()], [entry({ checks: [old] })])).length).toBeGreaterThan(0);
  });

  it("選択肢の文と理由の URL_場所と種類だけを報告する", () => {
    const [a, b] = [choiceA, choiceB];
    expect(
      run(
        notebook(
          [unit()],
          [entry({ checks: [check({ choices: [a, { ...b, reason: "理由 https://example.com/" }] })] })],
        ),
      ),
    ).toEqual(["notebook.ex-smp-xx.json: entries[0].checks[0].choices[1].reason: 本文に URL が含まれています"]);
  });

  it("要点が一言の部分文字列でない_場所と種類だけを報告する", () => {
    expect(run(notebook([unit()], [entry({ keyPhrase: "一言にない語" })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].keyPhrase: 一言(oneLine)の中にない文字列です",
    ]);
  });

  it("検証の状態が決まった値でない・未知の項目_指摘する", () => {
    expect(run(notebook([unit()], [entry({ status: "draft" })]))).toHaveLength(1);
    expect(run(notebook([unit({ extra: 1 })], []))).toHaveLength(1);
  });

  it("比較の表の値の数が列の数と違う_場所と種類だけを報告する", () => {
    const comparison = {
      columns: ["左", "右"],
      rows: [
        { aspect: "観点", cells: ["値 1", "値 2"], highlight: true },
        { aspect: "観点 2", cells: ["a", "b", "c"] },
      ],
    };
    expect(run(notebook([unit({ comparison })], []))).toEqual([
      "notebook.ex-smp-xx.json: units[0].comparison.rows[1].cells: 値の数が列の数と違います",
    ]);
  });

  it("本文の URL_場所と種類だけを報告する", () => {
    expect(run(notebook([unit()], [entry({ body: "解説 https://example.com/" })]))).toEqual([
      "notebook.ex-smp-xx.json: entries[0].body: 本文に URL が含まれています",
    ]);
  });

  it("図の比較の項目の状態(消える・残る)_任意の項目として通り_決まった値でなければ指摘する", () => {
    const diagram = (state: unknown) => ({
      type: "compare",
      title: "DROP したとき",
      left: { heading: "マネージド", items: [{ label: "メタデータ", state: "removed" }, { label: "ファイル" }] },
      right: {
        heading: "外部",
        items: [
          { label: "メタデータ", state: "removed" },
          { label: "ファイル", state },
        ],
      },
    });
    expect(run(notebook([unit({ diagram: diagram("kept") })], []))).toEqual([]);
    expect(run(notebook([unit({ diagram: diagram("gone") })], []))).toHaveLength(1);
  });
});
