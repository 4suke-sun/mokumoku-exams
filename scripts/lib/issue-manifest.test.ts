import { describe, expect, it } from "vitest";
import {
  checkDraft,
  formatResults,
  ghArgs,
  isManifestName,
  issueNumberFromUrl,
  type ManifestEntry,
  parseDraft,
  sealInput,
  unsealedAmongSealed,
  validateManifest,
  verifySeals,
} from "./issue-manifest.ts";

const create = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  action: "create",
  file: "a.md",
  milestone: "v0.5.0",
  labels: ["chore"],
  ...over,
});

describe("validateManifest", () => {
  it("新規と編集がそろっている_エラーなし", () => {
    expect(validateManifest([create(), { action: "edit", file: "b.md", number: 5, milestone: "v0.5.0" }])).toEqual([]);
  });

  it("配列でない_報告する", () => {
    expect(validateManifest({})).toEqual(["一覧が配列でない"]);
  });

  it("編集に番号がない_報告する", () => {
    expect(validateManifest([{ action: "edit", file: "b.md" }])).toEqual([
      "1 行目: 編集には、Issue の番号(number)が要る",
    ]);
  });

  it("新規に番号がある_報告する", () => {
    expect(validateManifest([create({ number: 3 })])).toEqual(["1 行目: 新規に number は付けない"]);
  });

  it("マイルストーンの形が違う_報告する", () => {
    expect(validateManifest([create({ milestone: "0.5" })])).toEqual(["1 行目: milestone が vX.Y.Z の形でない"]);
  });

  it("版が未定でlaterがない新規_報告する", () => {
    const errors = validateManifest([create({ milestone: undefined, labels: ["chore"] })]);
    expect(errors).toEqual(["1 行目: マイルストーンがない新規の Issue には、ラベル later が要る"]);
  });

  it("版が未定でlaterがある新規_エラーなし", () => {
    expect(validateManifest([create({ milestone: undefined, labels: ["chore", "later"] })])).toEqual([]);
  });

  it("マイルストーンがあるのにlaterがある_報告する", () => {
    expect(validateManifest([create({ labels: ["later"] })])).toEqual([
      "1 行目: マイルストーンがある Issue に、ラベル later は付けない",
    ]);
  });

  it("同じ下書きが重なる_報告する", () => {
    expect(validateManifest([create(), create()])).toEqual(["2 行目: 同じ下書きが重なっている"]);
  });

  it("同じIssueを編集する行が重なる_報告する", () => {
    const edit = (file: string): ManifestEntry => ({ action: "edit", file, number: 5 });
    expect(validateManifest([edit("a.md"), edit("b.md")])).toEqual(["2 行目: 同じ Issue を編集する行が重なっている"]);
  });

  it("ラベルにカンマや空がある_報告する", () => {
    expect(validateManifest([create({ labels: ["a,b"] })])).toHaveLength(1);
    expect(validateManifest([create({ labels: [""] })])).toHaveLength(1);
  });

  it("resultの形が崩れている_報告する", () => {
    expect(validateManifest([{ ...create(), result: { number: "x" } }])).toEqual(["1 行目: result の形が正しくない"]);
  });

  it("下書きのパスが親へ出る_報告する", () => {
    expect(validateManifest([create({ file: "../x.md" })])).toEqual(["1 行目: file が相対のファイル名でない"]);
  });
});

describe("parseDraft と checkDraft", () => {
  const good = "# fix: 題\n\n本文\n";

  it("1 行目がタイトル_タイトルと本文に分ける", () => {
    expect(parseDraft(good)).toEqual({ title: "fix: 題", body: "本文\n" });
  });

  it("2 行目が空行でない_解釈できない", () => {
    expect(parseDraft("# fix: 題\n本文\n")).toBeNull();
  });

  it("1 行目が#でない_解釈できない", () => {
    expect(parseDraft("題\n\n本文")).toBeNull();
    expect(checkDraft("a.md", "題\n\n本文")).toEqual(["a.md: 1 行目が「# タイトル」で、2 行目が空行の形でない"]);
  });

  it("正しい下書き_エラーなし", () => {
    expect(checkDraft("a.md", good)).toEqual([]);
    expect(checkDraft("a.md", "# feat(scripts): 題\n\n本文")).toEqual([]);
  });

  it("題がConventional Commitsの形でない_報告する", () => {
    expect(checkDraft("a.md", "# 題だけ\n\n本文")).toEqual(["a.md: タイトルが Conventional Commits の形でない"]);
  });

  it("本文に対象バージョンの行がある_版はマイルストーンだけで持つと報告する", () => {
    const errors = checkDraft("a.md", "# fix: 題\n\n対象バージョン: v0.5.0\n\n本文");
    expect(errors).toEqual(["a.md: 本文に版の番号の行がある(版はマイルストーンだけで持つ)"]);
  });

  it.each([
    ["- 対象バージョン: v0.5.0"],
    ["**対象バージョン**: v0.5.0"],
    ["対象バージョン：v0.5.0"],
    ["> 対象の版: v0.5.0"],
    ["## 対象バージョン: v0.5.0"],
    ["1. 対象バージョン: v0.5.0"],
    ["| 対象バージョン: v0.5.0 |"],
  ])("箇条書きと太字と全角コロンの版の行_報告する(%s)", (line) => {
    expect(checkDraft("a.md", `# fix: 題\n\n${line}\n`)).toHaveLength(1);
  });
});

describe("sealInput", () => {
  it("一覧の項目が変わる_封印の元も変わる", () => {
    const base = sealInput(create(), "h");
    expect(sealInput(create({ milestone: "v0.6.0" }), "h")).not.toBe(base);
    expect(sealInput(create({ labels: ["x"] }), "h")).not.toBe(base);
    expect(sealInput(create({ action: "edit", number: 3 }), "h")).not.toBe(base);
    expect(sealInput(create(), "other")).not.toBe(base);
  });

  it("ラベルの並びが違うだけ_同じ封印にする", () => {
    expect(sealInput(create({ labels: ["a", "b"] }), "h")).toBe(sealInput(create({ labels: ["b", "a"] }), "h"));
  });
});

describe("verifySeals", () => {
  it("ハッシュが一致_エラーなし", () => {
    expect(verifySeals([create({ sha256: "aaa" })], { "a.md": "aaa" })).toEqual([]);
  });

  it("ハッシュがない_封印を求める", () => {
    expect(verifySeals([create()], { "a.md": "aaa" })).toEqual(["a.md: 承認の時点の封印がない(--seal で記録する)"]);
  });

  it("承認のあとに下書きや一覧の項目が変わった_やり直しを求める", () => {
    expect(verifySeals([create({ sha256: "aaa" })], { "a.md": "bbb" })).toEqual([
      "a.md: 下書きまたは一覧の項目が、承認の時点から変わっている(検査と承認をやり直す)",
    ]);
  });

  it("投稿済みの行_照合しない", () => {
    const posted = create({ result: { number: 1, title: "t", url: "u" } });
    expect(verifySeals([posted], {})).toEqual([]);
  });
});

describe("ghArgs", () => {
  it("新規_題と本文とマイルストーンとラベルを渡す", () => {
    expect(ghArgs(create({ labels: ["chore", "ci"] }), "chore: 題", "/tmp/b.md")).toEqual([
      "issue",
      "create",
      "--title",
      "chore: 題",
      "--body-file",
      "/tmp/b.md",
      "--milestone",
      "v0.5.0",
      "--label",
      "chore",
      "--label",
      "ci",
    ]);
  });

  it("マイルストーンのない新規_マイルストーンを渡さない", () => {
    const args = ghArgs(create({ milestone: undefined, labels: ["later"] }), "chore: 題", "/tmp/b.md");
    expect(args).not.toContain("--milestone");
  });

  it("編集でマイルストーンを付ける_laterを外す", () => {
    const args = ghArgs({ action: "edit", file: "b.md", number: 7, milestone: "v0.5.0" }, "docs: 題", "/tmp/b.md");
    expect(args).toContain("--remove-label");
    expect(args[args.indexOf("--remove-label") + 1]).toBe("later");
  });

  it("編集_番号を渡しラベルは追加にする", () => {
    const args = ghArgs({ action: "edit", file: "b.md", number: 7, labels: ["docs"] }, "docs: 題", "/tmp/b.md");
    expect(args.slice(0, 3)).toEqual(["issue", "edit", "7"]);
    expect(args).toContain("--add-label");
  });
});

describe("issueNumberFromUrl と formatResults", () => {
  it("gh の出力のURL_番号を取り出す", () => {
    expect(issueNumberFromUrl("https://github.com/o/r/issues/42\n")).toBe(42);
    expect(issueNumberFromUrl("警告\nhttps://github.com/o/r/issues/7")).toBe(7);
    expect(issueNumberFromUrl("URL なし")).toBeNull();
  });

  it("結果の一覧_番号とタイトルとURLを表にし_未投稿を示す", () => {
    const table = formatResults([
      create({ result: { number: 5, title: "chore: 題", url: "https://example.com/5" } }),
      create({ file: "b.md" }),
    ]);
    expect(table).toContain("| #5 | chore: 題 | https://example.com/5 |");
    expect(table).toContain("| (未投稿) | b.md | |");
  });
});

describe("isManifestName", () => {
  it("用途ごとの別名_受け付ける", () => {
    expect(isManifestName("manifest-lessons.json")).toBe(true);
    expect(isManifestName("manifest-v0-99-0.json")).toBe(true);
  });

  it("既定の名前や決まりの外の名前_受け付けない", () => {
    for (const name of [
      "manifest.json",
      "manifest-.json",
      "manifest-Lessons.json",
      "other.json",
      "manifest-a.json.bak",
    ]) {
      expect(isManifestName(name)).toBe(false);
    }
  });
});

describe("unsealedAmongSealed", () => {
  const seal = "0".repeat(64);
  const posted = { number: 9, title: "chore: 題", url: "https://example.com/9" };

  it("封印のある行と封印のない行が混ざる_封印のない行の file を返す", () => {
    expect(unsealedAmongSealed([create({ sha256: seal }), create({ file: "b.md" })])).toEqual(["b.md"]);
  });

  it("封印のない行だけ_空を返す", () => {
    expect(unsealedAmongSealed([create(), create({ file: "b.md" })])).toEqual([]);
  });

  it("封印のある行だけ_空を返す", () => {
    expect(unsealedAmongSealed([create({ sha256: seal }), create({ file: "b.md", sha256: seal })])).toEqual([]);
  });

  it("封印のある行が投稿済みだけ_投稿済みの行を数えず空を返す", () => {
    expect(unsealedAmongSealed([create({ sha256: seal, result: posted }), create({ file: "b.md" })])).toEqual([]);
  });

  it("投稿済みで封印のない行_数えない", () => {
    expect(unsealedAmongSealed([create({ sha256: seal }), create({ file: "b.md", result: posted })])).toEqual([]);
  });
});
