import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canContinue,
  checkPrerequisites,
  diffHash,
  diffStepStatus,
  formatDeployTable,
  formatDiffSummary,
  humanChecklist,
  judgeDeployNeed,
  latestVersionTag,
  previousTag,
  summarizeDiff,
} from "./deploy-plan.ts";

describe("previousTag", () => {
  const tags = ["v0.9.0", "v0.10.0", "v0.89.0", "v0.88.0", "v0.90.0"];

  it("版の数字が桁をまたぐ_数の大小で1つ前を選ぶ", () => {
    expect(previousTag(tags, "v0.10.0")).toBe("v0.9.0");
    expect(previousTag(tags, "v0.90.0")).toBe("v0.89.0");
  });

  it("最初の版_nullを返す", () => {
    expect(previousTag(tags, "v0.9.0")).toBeNull();
  });
});

describe("judgeDeployNeed", () => {
  it("アプリ_インフラ_契約_データ_ルート直下のファイルが変わる_デプロイが要る", () => {
    for (const file of [
      "packages/app/src/a.ts",
      "packages/infra/lib/web-stack.ts",
      "packages/data-schema/src/x.ts",
      "data/questions.x.json",
      "package.json",
    ]) {
      expect(judgeDeployNeed([file]).needed, file).toBe(true);
    }
  });

  it("scriptsと.githubとpipelineとdocsだけが変わる_デプロイは要らない(CIは全ジョブを動かすが、デプロイには影響しない)", () => {
    const need = judgeDeployNeed([
      "scripts/deploy.ts",
      ".github/workflows/ci.yml",
      "packages/pipeline/src/a.ts",
      "docs/a.md",
      ".claude/skills/x/SKILL.md",
    ]);
    expect(need).toEqual({ needed: false, count: 0, releaseNotesOnly: false });
  });

  it("リリースノートだけが変わる_デプロイが要り_省いてよい版として区別する(CIのe2eは動かさない変更)", () => {
    expect(judgeDeployNeed(["data/release-notes.json", "docs/a.md"])).toEqual({
      needed: true,
      count: 1,
      releaseNotesOnly: true,
    });
    expect(judgeDeployNeed(["data/release-notes.json", "packages/app/a.ts"]).releaseNotesOnly).toBe(false);
  });

  it("変更がない_デプロイは要らない", () => {
    expect(judgeDeployNeed([]).needed).toBe(false);
  });
});

describe("checkPrerequisites", () => {
  const ok = {
    version: "v0.90.0",
    tagCommit: "abc",
    headCommit: "abc",
    latestTag: "v0.90.0",
    dirty: false,
    envFileExists: true,
    envTracked: false,
    awsAuthorized: true,
  };

  it("すべてそろっている_エラーがない", () => {
    expect(checkPrerequisites(ok)).toEqual([]);
  });

  it("AWSの認証を確かめられない_失敗にしない", () => {
    expect(checkPrerequisites({ ...ok, awsAuthorized: null })).toEqual([]);
  });

  it("タグがない_先に版を切るよう示す", () => {
    expect(checkPrerequisites({ ...ok, tagCommit: null })[0]).toContain("タグ v0.90.0 がない");
  });

  it("先頭がタグのコミットでない_止める", () => {
    expect(checkPrerequisites({ ...ok, headCommit: "def" })).toEqual(["作業ツリーの先頭が、版のタグのコミットでない"]);
  });

  it("未コミットの変更と.envの欠落とAWS認証の失敗_すべて報告する", () => {
    expect(checkPrerequisites({ ...ok, dirty: true, envFileExists: false, awsAuthorized: false })).toHaveLength(3);
  });

  it("新しい版のタグがある_古い版を通さない", () => {
    expect(checkPrerequisites({ ...ok, latestTag: "v0.91.0" })[0]).toContain("最新のタグでない");
  });

  it("envが追跡されている_止める", () => {
    expect(checkPrerequisites({ ...ok, envTracked: true })).toEqual([".env が git に追跡されている"]);
  });

  it("版の形が違う_止める", () => {
    expect(checkPrerequisites({ ...ok, version: "90" })).toContain("版が vX.Y.Z の形でない");
  });
});

const DIFF = `Stack mokumoku-web
IAM Statement Changes
┌───┬──────────┬────────┬────────┐
│   │ Resource │ Effect │ Action │
└───┴──────────┴────────┴────────┘
Resources
[~] AWS::Lambda::Function App
 └─ [~] Environment
     ├─ [-] {"ORIGIN_VERIFY_VALUE":"***"}
     └─ [+] {"ORIGIN_VERIFY_VALUE":"***"}
[+] AWS::IAM::Role Extra
[-] AWS::S3::Bucket Old
[~] AWS::CloudFront::Distribution Dist

Stack mokumoku-data
[+] AWS::DynamoDB::Table T
`;

describe("summarizeDiff", () => {
  it("差分の出力_スタックとリソースの種類と件数とIAMと公開設定と削除を数える", () => {
    const summary = summarizeDiff(DIFF);
    expect(summary.understood).toBe(true);
    expect(summary.stacks).toEqual(["mokumoku-web", "mokumoku-data"]);
    expect(summary.resources["AWS::Lambda::Function"]).toEqual({ add: 0, change: 1, remove: 0 });
    expect(summary.resources["AWS::S3::Bucket"]).toEqual({ add: 0, change: 0, remove: 1 });
    expect(summary.iam).toBe(true);
    expect(summary.publicSetting).toBe(true);
    expect(summary.removals).toBe(1);
  });

  it("要約_行の本文を持たず環境変数の値が出ない", () => {
    const text = `Stack s\n[~] AWS::Lambda::Function F\n ├─ [-] {"EXAMPLE_NAME":"example-line-text"}\n`;
    const out = JSON.stringify(summarizeDiff(text)) + formatDiffSummary(summarizeDiff(text)).join("\n");
    expect(out).not.toContain("example-line-text");
    expect(out).not.toContain("EXAMPLE_NAME");
  });

  it("変更なしの表示_変更のあるスタックなしと要約する", () => {
    const summary = summarizeDiff("There were no differences\n");
    expect(summary.understood).toBe(true);
    expect(formatDiffSummary(summary)[0]).toBe("変更のあるスタック: なし");
  });

  it("形を解釈できない出力_全文を読むよう促す", () => {
    expect(formatDiffSummary(summarizeDiff("想定外の出力\n"))).toEqual([
      "差分の形を解釈できなかった。伏せた全文を読む",
    ]);
  });

  it("要約の行_種類ごとの件数とIAMと削除を人が読める形で出す", () => {
    const lines = formatDiffSummary(summarizeDiff(DIFF));
    expect(lines).toContain("AWS::Lambda::Function: 追加 0 / 変更 1 / 削除 0");
    expect(lines).toContain("IAM の変更: あり");
    expect(lines).toContain("削除: あり(1 件)");
  });
});

describe("diffStepStatus", () => {
  it("形を解釈できない差分_失敗にせず待ちにして関門へ進む", () => {
    expect(diffStepStatus(summarizeDiff("想定外の出力\n"))).toBe("wait");
    expect(diffStepStatus(summarizeDiff(DIFF))).toBe("ok");
  });
});

describe("latestVersionTag", () => {
  it("版の形でないタグが混ざる_数えず最新の版を返す", () => {
    expect(latestVersionTag(["v0.9.0", "v0.10.0", "vNext", "v1", "release-1"])).toBe("v0.10.0");
  });

  it("版の形のタグがない_空を返す", () => {
    expect(latestVersionTag(["vNext"])).toBe("");
  });
});

describe("diffHash", () => {
  it("同じ差分_同じハッシュになり_違う差分では変わる", () => {
    expect(diffHash("a")).toBe(diffHash("a"));
    expect(diffHash("a")).not.toBe(diffHash("b"));
  });
});

describe("humanChecklist", () => {
  it("デプロイ後の画面確認の文書_3節の表の項目名を取り出す", () => {
    const doc = readFileSync(new URL("../../docs/post-deploy-smoke.md", import.meta.url), "utf8");
    const items = humanChecklist(doc);
    expect(items).toContain("サインイン");
    expect(items).toContain("新規登録と退会");
    expect(items).not.toContain("項目");
  });

  it("3節がない文書_空を返す", () => {
    expect(humanChecklist("# 題\n")).toEqual([]);
  });
});

describe("formatDeployTable", () => {
  it("待ちの段階_失敗ではなく先へ進めない印として表に出る", () => {
    const steps = [
      { name: "差分", status: "ok" as const, note: "x" },
      { name: "関門", status: "wait" as const, note: "承認待ち" },
    ];
    expect(formatDeployTable(steps)).toContain("| 関門 | 待ち | 承認待ち |");
    expect(canContinue(steps)).toBe(true);
    expect(canContinue([...steps, { name: "y", status: "fail", note: "" }])).toBe(false);
  });
});
