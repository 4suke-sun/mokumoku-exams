import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./validate-curriculum-data.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "curriculum-data-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const run = (...args: string[]) => spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });

const exams = { exams: [{ examCode: "SAMPLE", status: "published" }] };
const questions = { examCode: "SAMPLE", questions: [{ questionId: "SAMPLE-0001" }] };
const curriculum = (questionIds: string[]) => ({
  examCode: "SAMPLE",
  units: [{ id: "unit", title: "単元", order: 1, sections: [{ id: "s", title: "節", body: "本文" }], questionIds }],
});

describe("validate-curriculum-data", () => {
  it("リポジトリの data/ が、検査を通る", () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
  });

  it("問題データにある問題だけを参照している_通る", () => {
    const dir = makeDir({
      "exams.json": exams,
      "questions.sample.json": questions,
      "curriculum.sample.json": curriculum(["SAMPLE-0001"]),
    });
    expect(run(dir).status).toBe(0);
  });

  it("問題データにない問題を参照している_失敗にする", () => {
    const dir = makeDir({
      "exams.json": exams,
      "questions.sample.json": questions,
      "curriculum.sample.json": curriculum(["SAMPLE-0002"]),
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/units\[0\]\.questionIds\[0\]: 問題データにない問題です/);
  });

  it("JSON として読めないときは、入力の一部を載せずに失敗にする", () => {
    const r = run(makeDir({ "exams.json": exams, "curriculum.sample.json": '{ "目印XYZ" 壊れた' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/curriculum\.sample\.json: JSON として読めません/);
    expect(r.stderr).not.toContain("目印XYZ");
  });

  it("引数が多いとき、成功にしない", () => {
    expect(run("a", "b").status).toBe(2);
  });
});
