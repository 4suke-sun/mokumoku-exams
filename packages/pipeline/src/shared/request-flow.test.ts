import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentStamp } from "./agents.ts";
import {
  cleanupImported,
  definitionChanged,
  discardStale,
  type FlowContext,
  failOutput,
  listRequestFiles,
  readJsonFile,
} from "./request-flow.ts";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "request-flow-"));
}

function context(dryRun = false): { ctx: FlowContext; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    ctx: { output: { out: (t) => out.push(t), err: (t) => err.push(t) }, stopLabel: "下書きの取り込みの停止", dryRun },
    out,
    err,
  };
}

describe("readJsonFile(共通の読み込みの、失敗時と形の不一致時の戻り値)", () => {
  it("ファイルがない_undefinedを返す", () => {
    expect(readJsonFile(join(tmp(), "missing.json"))).toBeUndefined();
  });

  it("JSONでない内容_undefinedを返す", () => {
    const path = join(tmp(), "broken.json");
    writeFileSync(path, "{ not json");
    expect(readJsonFile(path)).toBeUndefined();
  });

  it("空のファイル_undefinedを返す", () => {
    const path = join(tmp(), "empty.json");
    writeFileSync(path, "");
    expect(readJsonFile(path)).toBeUndefined();
  });

  it.each([
    ["配列", "[1,2]", [1, 2]],
    ["文字列", '"text"', "text"],
    ["数値", "42", 42],
    ["null", "null", null],
  ])("形が期待と違うJSON(%s)_形を検査せず、そのまま返す(形の検査は呼び出し側の責務)", (_name, text, expected) => {
    const path = join(tmp(), "shape.json");
    writeFileSync(path, text);
    expect(readJsonFile(path)).toEqual(expected);
  });

  it("オブジェクトのJSON_そのまま返す", () => {
    const path = join(tmp(), "ok.json");
    writeFileSync(path, '{"a":1}');
    expect(readJsonFile(path)).toEqual({ a: 1 });
  });
});

describe("listRequestFiles", () => {
  it("置き場がない_空の一覧を返す", () => {
    expect(listRequestFiles(join(tmp(), "none"))).toEqual([]);
  });

  it("jsonとそれ以外が混ざる_jsonだけをファイル名の順で返す", () => {
    const dir = tmp();
    for (const name of ["b.json", "a.json", "note.txt", "c.json.bak"]) writeFileSync(join(dir, name), "");
    expect(listRequestFiles(dir)).toEqual(["a.json", "b.json"]);
  });
});

describe("failOutput", () => {
  it("出力が検査に通らない_失敗の回数を足し、出力を消し、理由を報告する", () => {
    const dir = tmp();
    const outPath = join(dir, "key.json");
    writeFileSync(outPath, "{}");
    const attempts: Record<string, number> = { key: 1 };
    const { ctx, err, out } = context();
    failOutput(ctx, "key", "invalid", outPath, attempts);
    expect(attempts.key).toBe(2);
    expect(existsSync(outPath)).toBe(false);
    expect([...out, ...err].join("")).toContain("key invalid");
  });

  it("出力が元からない_失敗せず、回数だけを足す", () => {
    const attempts: Record<string, number> = {};
    const { ctx } = context();
    failOutput(ctx, "key", "invalid", join(tmp(), "none.json"), attempts);
    expect(attempts.key).toBe(1);
  });

  it("ドライラン_報告だけで、回数も出力も変えない", () => {
    const dir = tmp();
    const outPath = join(dir, "key.json");
    writeFileSync(outPath, "{}");
    const attempts: Record<string, number> = {};
    const { ctx } = context(true);
    failOutput(ctx, "key", "invalid", outPath, attempts);
    expect(attempts).toEqual({});
    expect(existsSync(outPath)).toBe(true);
  });
});

describe("discardStale", () => {
  it("依頼のあとに入力が変わった_依頼と出力の両方を消す", () => {
    const dir = tmp();
    const requestPath = join(dir, "req.json");
    const outPath = join(dir, "out.json");
    writeFileSync(requestPath, "{}");
    writeFileSync(outPath, "{}");
    const { ctx } = context();
    discardStale(ctx, "key", requestPath, outPath);
    expect(existsSync(requestPath)).toBe(false);
    expect(existsSync(outPath)).toBe(false);
  });

  it("出力が元からない_依頼だけを消し、失敗しない", () => {
    const dir = tmp();
    const requestPath = join(dir, "req.json");
    writeFileSync(requestPath, "{}");
    const { ctx } = context();
    discardStale(ctx, "key", requestPath, join(dir, "out-missing.json"));
    expect(existsSync(requestPath)).toBe(false);
  });

  it("ドライラン_何も消さない", () => {
    const dir = tmp();
    const requestPath = join(dir, "req.json");
    writeFileSync(requestPath, "{}");
    const { ctx } = context(true);
    discardStale(ctx, "key", requestPath, join(dir, "out.json"));
    expect(existsSync(requestPath)).toBe(true);
  });
});

describe("definitionChanged", () => {
  const stamp = (hash: string): AgentStamp => ({ role: "question-drafter", model: "m", definitionHash: hash });

  it("依頼にエージェントの記録がない_変わったとみなす", () => {
    expect(definitionChanged({}, stamp("a"))).toBe(true);
  });

  it("定義のハッシュが同じ_変わっていない", () => {
    expect(definitionChanged({ agent: stamp("a") }, stamp("a"))).toBe(false);
  });

  it("定義のハッシュが違う_変わった", () => {
    expect(definitionChanged({ agent: stamp("a") }, stamp("b"))).toBe(true);
  });
});

describe("cleanupImported", () => {
  it("取り込み済みの依頼と出力_消し、片方がないファイルがあっても失敗しない", () => {
    const requests = tmp();
    const outputs = tmp();
    mkdirSync(requests, { recursive: true });
    writeFileSync(join(requests, "a.json"), "{}");
    writeFileSync(join(outputs, "a.json"), "{}");
    writeFileSync(join(requests, "b.json"), "{}");
    cleanupImported(["a.json", "b.json"], requests, outputs);
    expect(existsSync(join(requests, "a.json"))).toBe(false);
    expect(existsSync(join(outputs, "a.json"))).toBe(false);
    expect(existsSync(join(requests, "b.json"))).toBe(false);
  });
});
