import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-unpublished-bundle.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TEXT = "非公開の設問文です。検査の例に使う、十分な長さの文です。";
const unpublished = JSON.stringify({
  examCode: "EX-SMP-XX",
  entries: [
    {
      verdict: "rewritable",
      reasons: ["judge:choices-weak"],
      question: { questionId: "SAMPLE-0003", questionText: TEXT },
    },
  ],
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "unpublished-bundle-"));
  created.push(dir);
  return dir;
}

function setup(files: { data?: Record<string, string>; build?: Record<string, string> | null }) {
  const data = temp();
  for (const [name, content] of Object.entries(files.data ?? {})) writeFileSync(join(data, name), content);
  const build = join(temp(), ".next");
  if (files.build !== null) {
    mkdirSync(join(build, "static"), { recursive: true });
    for (const [name, content] of Object.entries(files.build ?? {})) writeFileSync(join(build, name), content);
  }
  return { data, build };
}

const run = (...args: string[]) => spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });

describe("check-unpublished-bundle", () => {
  it("非公開の問題がない_何も検査せず成功にする(成果物がなくても通る)", () => {
    const { data, build } = setup({ data: { "questions.ex-smp-xx.json": "{}" }, build: null });
    const r = run(data, build);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("非公開の問題がないので、検査するものがありません");
  });

  it("非公開の問題があり_成果物に含まれない_成功にする", () => {
    const { data, build } = setup({
      data: { "unpublished.ex-smp-xx.json": unpublished },
      build: { "page.js": '{"questionText":"公開の設問"}' },
    });
    const r = run(data, build);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("非公開の問題 1 件");
  });

  it("成果物に設問文が含まれる_失敗にして_パスと ID だけを報告し本文は出さない", () => {
    const { data, build } = setup({
      data: { "unpublished.ex-smp-xx.json": unpublished },
      build: { "page.js": `{"q":"${TEXT}"}` },
    });
    const r = run(data, build);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SAMPLE-0003");
    expect(r.stderr).toContain("page.js");
    expect(r.stderr + r.stdout).not.toContain(TEXT);
  });

  it("成果物に ID だけが含まれる_失敗にする", () => {
    const { data, build } = setup({
      data: { "unpublished.ex-smp-xx.json": unpublished },
      build: { "static/chunk.js": 'ids=["SAMPLE-0003"]' },
    });
    expect(run(data, build).status).toBe(1);
  });

  it("非公開の問題があり_成果物のフォルダがない_検査できないまま通さず失敗にする", () => {
    const { data, build } = setup({ data: { "unpublished.ex-smp-xx.json": unpublished }, build: null });
    const r = run(data, build);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ビルド成果物のフォルダがありません");
  });

  it("成果物のフォルダはあるが_探せるファイルが 1 つもない_検査できないまま通さず失敗にする", () => {
    const { data, build } = setup({ data: { "unpublished.ex-smp-xx.json": unpublished }, build: {} });
    const r = run(data, build);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("探せるファイルがありません");
  });

  it("読まずに飛ばしたものがある_件数を報告に出す", () => {
    const { data, build } = setup({
      data: { "unpublished.ex-smp-xx.json": unpublished },
      build: { "page.js": "{}" },
    });
    symlinkSync(join(build, "page.js"), join(build, "link.js"));
    const r = run(data, build);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("読まずに飛ばしたもの 1 件");
  });

  it("引数が足りない_使い方を出して 2 で終わる", () => {
    expect(run().status).toBe(2);
    expect(run("data").status).toBe(2);
  });
});
