import { describe, expect, it } from "vitest";
import { checkDataRelease, isDeliveredData } from "./data-release-check.ts";

describe("isDeliveredData", () => {
  it("data/ の直下の問題・試験・ヘルプなどの JSON_配信するデータとみなす", () => {
    for (const path of [
      "data/questions.aws-x-01.json",
      "data/exams.json",
      "data/help.json",
      "data/curriculum.x.json",
    ]) {
      expect(isDeliveredData(path), path).toBe(true);
    }
  });

  it("リリースノート、非公開の問題、data/ の外、下の階層、JSON でないファイル_配信するデータとみなさない", () => {
    for (const path of [
      "data/release-notes.json",
      "data/unpublished.aws-x-01.json",
      "docs/data-spec.md",
      "packages/app/data/x.json",
      "data/sub/x.json",
      "data/README.md",
    ]) {
      expect(isDeliveredData(path), path).toBe(false);
    }
  });
});

describe("checkDataRelease", () => {
  const data = ["data/questions.aws-x-01.json"];

  it("配信するデータを変え、先頭の版が基準より新しくない_止める", () => {
    expect(checkDataRelease({ changedFiles: data, baseTop: "v0.80.0", headTop: "v0.80.0" })).toHaveLength(1);
    expect(checkDataRelease({ changedFiles: data, baseTop: "v0.80.0", headTop: "v0.79.0" })).toHaveLength(1);
  });

  it("配信するデータを変え、先頭の版が基準より新しい_通す", () => {
    expect(checkDataRelease({ changedFiles: data, baseTop: "v0.80.0", headTop: "v0.81.0" })).toEqual([]);
    expect(checkDataRelease({ changedFiles: data, baseTop: "v0.80.0", headTop: "v0.80.1" })).toEqual([]);
  });

  it("リリースノートだけを変える PR_版を比べずに通す", () => {
    const changedFiles = ["data/release-notes.json"];
    expect(checkDataRelease({ changedFiles, baseTop: "v0.80.0", headTop: "v0.80.0" })).toEqual([]);
  });

  it("配信するデータを変えない PR_版を比べずに通す", () => {
    const changedFiles = ["scripts/x.ts", "data/unpublished.aws-x-01.json"];
    expect(checkDataRelease({ changedFiles, baseTop: "v0.80.0", headTop: "v0.80.0" })).toEqual([]);
  });

  it("先頭の版を読めない_配信するデータを変える PR を止める", () => {
    expect(checkDataRelease({ changedFiles: data, baseTop: "v0.80.0", headTop: null })).toHaveLength(1);
  });

  it("基準にリリースノートがない(最初の版)_先頭の版があれば通す", () => {
    expect(checkDataRelease({ changedFiles: data, baseTop: null, headTop: "v0.1.0" })).toEqual([]);
  });
});
