import { describe, expect, it } from "vitest";
import { USER_ITEM_TYPES as SCRIPT_USER_ITEM_TYPES } from "../../../../scripts/lib/release-notes-check.ts";
import { listReleases, RELEASE_ITEM_LABELS, RELEASE_ITEM_TONES, USER_ITEM_TYPES, userItems } from "./release-notes.ts";
import { REPOSITORY_URL, releaseUrl } from "./site.ts";

const parts = (version: string) => version.slice(1).split(".").map(Number);
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

describe("listReleases", () => {
  it("新しい版から順に並ぶ", () => {
    const versions = listReleases().map((r) => r.version);
    expect(versions.length).toBeGreaterThan(0);
    for (let i = 1; i < versions.length; i++) {
      expect(newer(versions[i - 1] as string, versions[i] as string), versions[i]).toBe(true);
    }
  });

  it("どの項目の種類にも_表示名がある", () => {
    for (const release of listReleases()) {
      for (const item of release.items) expect(RELEASE_ITEM_LABELS[item.type], item.type).toBeTruthy();
    }
  });

  it("画面に出す項目の種類_色があり_種類ごとに違う", () => {
    for (const release of listReleases()) {
      for (const item of userItems(release)) expect(RELEASE_ITEM_TONES[item.type], item.type).toMatch(/^tone-/);
    }
    const tones = Object.values(RELEASE_ITEM_TONES);
    expect(new Set(tones).size).toBe(tones.length);
  });
});

describe("userItems", () => {
  it("開発の項目が混ざった版_利用者向けの項目だけを元の並びで返す", () => {
    const items = [
      { type: "dev", text: "開発 1" },
      { type: "feat", text: "機能" },
      { type: "fix", text: "修正" },
      { type: "dev", text: "開発 2" },
      { type: "docs", text: "文書" },
    ];
    expect(userItems({ items }).map((item) => item.text)).toEqual(["機能", "修正", "文書"]);
  });

  it("開発の項目だけの版_空を返す", () => {
    expect(userItems({ items: [{ type: "dev", text: "開発" }] })).toEqual([]);
  });

  it("画面に出す種類_スクリプトの利用者向けの種類と一致する", () => {
    expect([...USER_ITEM_TYPES]).toEqual([...SCRIPT_USER_ITEM_TYPES]);
  });
});

describe("releaseUrl", () => {
  it("版_リポジトリのその版のタグの Release のページを返す", () => {
    expect(releaseUrl("v0.81.0")).toBe(`${REPOSITORY_URL}/releases/tag/v0.81.0`);
  });

  it("開発の項目だけの既存の版_どれも Release のページの形になる", () => {
    for (const release of listReleases().filter((r) => userItems(r).length === 0)) {
      expect(releaseUrl(release.version)).toMatch(
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/tag\/v\d+\.\d+\.\d+$/,
      );
    }
  });
});
