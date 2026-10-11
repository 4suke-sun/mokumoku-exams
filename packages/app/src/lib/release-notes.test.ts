import { describe, expect, it } from "vitest";
import { listReleases, RELEASE_ITEM_LABELS, RELEASE_ITEM_TONES } from "./release-notes.ts";

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

  it("どの項目の種類にも_色があり_種類ごとに違う", () => {
    for (const release of listReleases()) {
      for (const item of release.items) expect(RELEASE_ITEM_TONES[item.type], item.type).toMatch(/^tone-/);
    }
    const tones = Object.values(RELEASE_ITEM_TONES);
    expect(new Set(tones).size).toBe(tones.length);
  });
});
