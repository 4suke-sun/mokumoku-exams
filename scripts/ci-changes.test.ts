import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// CI の `changes` ジョブのシェルを、実際に実行して、変更したパスごとに動くジョブを確かめる。
const ci = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8");

/** `- id: paths` のステップの `run: |` の本文を取り出す(インデントを除く)。 */
function pathsScript(): string {
  const lines = ci.split("\n");
  const start = lines.findIndex((l) => l.trim() === "- id: paths");
  const run = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  const indent = (lines[run + 1] ?? "").search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

// フックの中で実行されても、一時リポジトリの操作がずれないよう、git の環境変数を引き継がない
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** 基準のコミットに対して、files を追加したコミットを作り、changes ジョブのシェルの出力を返す。 */
function outputsFor(files: string[], event = "pull_request"): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "ci-changes-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@users.noreply.github.com", "-c", "commit.gpgsign=false", ...args],
      { cwd: dir, encoding: "utf8", env: cleanEnv },
    ).trim();
  git("init", "-q");
  writeFileSync(join(dir, "base.txt"), "base");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD");
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), "x");
  }
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "change");
  const head = git("rev-parse", "HEAD");
  const out = join(dir, "..", `${dir.split("/").pop()}.out`);
  writeFileSync(out, "");
  dirs.push(out);
  execFileSync("bash", ["-c", pathsScript()], {
    cwd: dir,
    env: { ...cleanEnv, EVENT_NAME: event, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: out },
  });
  return Object.fromEntries(
    readFileSync(out, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => l.split("=") as [string, string]),
  );
}

describe("CIのchangesジョブ", () => {
  it("リリースノートだけの変更_appは動かしe2eは動かさない", () => {
    expect(outputsFor(["data/release-notes.json"])).toEqual({
      app: "true",
      e2e: "false",
      infra: "false",
      pipeline: "false",
    });
  });

  it("問題データの変更_appとe2eを動かす", () => {
    const out = outputsFor(["data/questions.example.json"]);
    expect(out.app).toBe("true");
    expect(out.e2e).toBe("true");
  });

  it("リリースノートと問題データの変更_e2eも動かす", () => {
    expect(outputsFor(["data/release-notes.json", "data/exams.json"]).e2e).toBe("true");
  });

  it("appのソースの変更_appとe2eだけ動かす", () => {
    expect(outputsFor(["packages/app/src/a.ts"])).toEqual({
      app: "true",
      e2e: "true",
      infra: "false",
      pipeline: "false",
    });
  });

  it.each([["docs/known-issues.md"], [".claude/agents/question-drafter.md"], ["data/exams.json"]])(
    "pipelineのテストが読むファイルの変更_pipelineを動かす(%s)",
    (file) => {
      expect(outputsFor([file]).pipeline).toBe("true");
    },
  );

  it("スキルの文書だけの変更_どのジョブも動かさない", () => {
    expect(outputsFor([".claude/skills/dev-pr/SKILL.md"])).toEqual({
      app: "false",
      e2e: "false",
      infra: "false",
      pipeline: "false",
    });
  });

  it("scriptsの変更_すべて動かす", () => {
    expect(outputsFor(["scripts/a.ts"])).toEqual({ app: "true", e2e: "true", infra: "true", pipeline: "true" });
  });

  it("mainへのpush_すべて動かす", () => {
    expect(outputsFor(["docs/a.md"], "push")).toEqual({ app: "true", e2e: "true", infra: "true", pipeline: "true" });
  });
});
