import { describe, expect, it } from "vitest";
import type { Release } from "./release-notes-check.ts";
import {
  checkTagCorrespondence,
  checkTagHasEntry,
  compareVersions,
  formatRelease,
  validateReleaseNotes,
} from "./release-notes-check.ts";

const release = (version: string, overrides: Partial<Release> = {}): Release => ({
  version,
  date: "2026-10-08",
  title: "タイトル",
  items: [{ type: "dev", text: "内容" }],
  ...overrides,
});

describe("compareVersions", () => {
  it("数値として比較する(0.10.0 は 0.9.0 より新しい)", () => {
    expect(compareVersions("v0.10.0", "v0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("v0.0.1", "v0.0.2")).toBeLessThan(0);
    expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0);
  });
});

describe("validateReleaseNotes", () => {
  it("先頭ゼロの版を認めない", () => {
    expect(validateReleaseNotes({ releases: [release("v01.2.3")] })).toEqual([
      "releases[0].version: vX.Y.Z の形式ではありません",
    ]);
    expect(validateReleaseNotes({ releases: [release("v0.00.1")] })).toHaveLength(1);
  });

  it("型の違う値を弾く", () => {
    expect(validateReleaseNotes(null)).toHaveLength(1);
    expect(validateReleaseNotes({ releases: [null] })).toEqual(["releases[0]: オブジェクトではありません"]);
    expect(validateReleaseNotes({ releases: [release("v0.0.1", { title: 1 as unknown as string })] })).toEqual([
      "releases[0].title: 空です",
    ]);
    expect(validateReleaseNotes({ releases: [release("v0.0.1", { items: [{ type: "dev", text: "" }] })] })).toEqual([
      "releases[0].items[0].text: 空です",
    ]);
  });

  it("日付の形式違いを弾く", () => {
    expect(validateReleaseNotes({ releases: [release("v0.0.1", { date: "2026-1-1" })] })).toHaveLength(1);
  });

  it("正しい構造は通す", () => {
    expect(validateReleaseNotes({ releases: [release("v0.0.2"), release("v0.0.1")] })).toEqual([]);
  });

  it("releases が無い・空のとき", () => {
    expect(validateReleaseNotes({})).toHaveLength(1);
    expect(validateReleaseNotes({ releases: [] })).toEqual(["releases が空です"]);
  });

  it("版の形式、重複、並び順を検査する", () => {
    expect(validateReleaseNotes({ releases: [release("0.0.1")] })).toEqual([
      "releases[0].version: vX.Y.Z の形式ではありません",
    ]);
    expect(validateReleaseNotes({ releases: [release("v0.0.1"), release("v0.0.1")] })).toEqual([
      "releases[1].version: 版が重複しています",
      "releases[1].version: 新しい順に並んでいません",
    ]);
    expect(validateReleaseNotes({ releases: [release("v0.0.1"), release("v0.0.2")] })).toEqual([
      "releases[1].version: 新しい順に並んでいません",
    ]);
  });

  it("0.9.0 → 0.10.0 の順は、新しい順として通す", () => {
    expect(validateReleaseNotes({ releases: [release("v0.10.0"), release("v0.9.0")] })).toEqual([]);
  });

  it("日付が実在しないとき", () => {
    expect(validateReleaseNotes({ releases: [release("v0.0.1", { date: "2026-02-30" })] })).toEqual([
      "releases[0].date: YYYY-MM-DD の実在する日付ではありません",
    ]);
  });

  it("タイトルと項目を検査し、本文は報告に含めない", () => {
    const errors = validateReleaseNotes({
      releases: [release("v0.0.1", { title: " ", items: [{ type: "other", text: "秘密の本文" }] })],
    });
    expect(errors).toEqual([
      "releases[0].title: 空です",
      "releases[0].items[0].type: feat / fix / docs / dev のいずれかではありません",
    ]);
    expect(errors.join()).not.toContain("秘密の本文");
  });

  it("項目が空のとき", () => {
    expect(validateReleaseNotes({ releases: [release("v0.0.1", { items: [] })] })).toEqual([
      "releases[0].items: 1 件以上の配列ではありません",
    ]);
  });
});

describe("checkTagCorrespondence", () => {
  const releases = [release("v0.0.2"), release("v0.0.1")];

  it("最新のエントリは、タグを切る前でもよい", () => {
    expect(checkTagCorrespondence(releases, ["v0.0.1"])).toEqual([]);
  });

  it("最新でないエントリにタグが無いとき", () => {
    expect(checkTagCorrespondence(releases, [])).toEqual(["リリースノートの v0.0.1 に対応するタグがありません"]);
  });

  it("エントリの無いタグを止める。`v` 以外で始まるタグは対象にしない", () => {
    expect(checkTagCorrespondence(releases, ["v0.0.1", "v0.0.2", "v0.0.3", "nightly"])).toEqual([
      "タグ v0.0.3 に対応するリリースノートのエントリがありません",
    ]);
  });

  it("`v` で始まるが vX.Y.Z ではないタグは、形式の誤りとして止める", () => {
    expect(checkTagCorrespondence(releases, ["v0.0.1", "v0.0.1-rc1", "v1.2", "v01.2.3"])).toEqual([
      "タグ v0.0.1-rc1 は vX.Y.Z の形式ではありません",
      "タグ v1.2 は vX.Y.Z の形式ではありません",
      "タグ v01.2.3 は vX.Y.Z の形式ではありません",
    ]);
  });
});

describe("checkTagHasEntry", () => {
  const releases = [release("v0.0.1")];

  it("エントリがあれば通す", () => {
    expect(checkTagHasEntry(releases, "v0.0.1")).toEqual([]);
  });

  it("エントリが無い・形式が違うとき", () => {
    expect(checkTagHasEntry(releases, "v0.0.2")).toHaveLength(1);
    expect(checkTagHasEntry(releases, "release-1")).toHaveLength(1);
  });
});

describe("formatRelease", () => {
  it("タイトルと項目を、種類のラベルつきの Markdown にする", () => {
    const body = formatRelease(release("v0.0.1", { title: "題", items: [{ type: "feat", text: "追加した" }] }));
    expect(body).toBe("題\n\n- 機能: 追加した\n");
  });
});
