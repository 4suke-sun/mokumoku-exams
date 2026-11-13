import { describe, expect, it } from "vitest";
import { sealInput, validateManifest } from "./issue-manifest.ts";
import {
  addDraftEntries,
  buildCandidate,
  type Candidate,
  closedMarks,
  DEFAULT_THRESHOLD,
  draftFileName,
  findRepeats,
  formatIssueDraft,
  type InboxRecord,
  inboxPath,
  LESSONS_LABEL,
  openByKey,
  parseInbox,
  serializeRecord,
  strongestPromotion,
  summarize,
  versionOfBranch,
} from "./lessons-inbox.ts";

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  type: "candidate",
  at: "2026-10-15T00:00:00.000Z",
  version: "v0.45.0",
  key: "stale-input",
  who: "subagent",
  cause: "unchecked",
  what: "古い入力を読んだ",
  should: "入力を書き出し直してから渡す",
  promote: "mechanical",
  ...over,
});

describe("buildCandidate", () => {
  const input = {
    key: "stale-input",
    who: "subagent",
    cause: "unchecked",
    promote: "rules",
    what: "古い入力を読んだ",
    should: "渡す前に書き出し直す",
  };

  it("すべての項目が正しい_1 件にまとめる", () => {
    const result = buildCandidate(input, { at: "t", version: "v0.45.0" });
    expect(result).toMatchObject({
      ok: true,
      candidate: { type: "candidate", key: "stale-input", version: "v0.45.0" },
    });
  });

  it("不正な項目がある_項目の名前だけを返し、値は返さない", () => {
    const result = buildCandidate(
      { ...input, key: "Bad Key!", cause: "dummy-value-xyz", what: "" },
      { at: "t", version: "v0.45.0" },
    );
    expect(result).toEqual({ ok: false, invalid: ["key", "cause", "what"] });
  });

  it("本文が改行を含む_受け付けない", () => {
    const result = buildCandidate({ ...input, what: "1 行目\n2 行目" }, { at: "t", version: "v" });
    expect(result).toEqual({ ok: false, invalid: ["what"] });
  });

  it("本文が上限を超える_受け付けない", () => {
    const result = buildCandidate({ ...input, should: "あ".repeat(201) }, { at: "t", version: "v" });
    expect(result).toEqual({ ok: false, invalid: ["should"] });
  });
});

describe("parseInbox", () => {
  it("壊れた行と形の合わない行_飛ばして読める行だけ返す", () => {
    const text = [
      serializeRecord(candidate()),
      "{ broken json\n",
      `${JSON.stringify({ type: "candidate", key: "ok-key", at: "t" })}\n`,
      serializeRecord({ type: "closed", at: "t", key: "stale-input", ref: "#1" }),
      "",
    ].join("");
    expect(parseInbox(text).map((r) => r.type)).toEqual(["candidate", "closed"]);
  });

  it("版の形が不正な行_読み込まない(読み込み側で版の形を検査する)", () => {
    const bad = `${JSON.stringify(candidate({ version: "latest" }))}\n`;
    expect(parseInbox(bad)).toEqual([]);
  });

  it("読み込みの検査に通らない記録_書き出さずに例外にする", () => {
    for (const record of [
      candidate({ version: "latest" }),
      candidate({ key: "Bad Key" }),
      candidate({ what: "改行を\n含む" }),
      candidate({ should: "あ".repeat(201) }),
      { type: "closed", at: "t", key: "stale-input", ref: "" } as InboxRecord,
    ]) {
      expect(() => serializeRecord(record)).toThrow();
    }
  });

  it("書き出せた記録_どれも読み戻すと同じ内容になる", () => {
    const records: InboxRecord[] = [
      candidate(),
      candidate({ version: "unknown", what: "あ".repeat(200) }),
      { type: "closed", at: "t", key: "stale-input", ref: "#1(起票済み)" },
    ];
    expect(parseInbox(records.map(serializeRecord).join(""))).toEqual(records);
  });

  it("書き出した行_読み戻すと同じ内容になる", () => {
    const record = candidate({ what: "禁止された語を書いた" });
    expect(parseInbox(serializeRecord(record))).toEqual([record]);
  });
});

describe("findRepeats", () => {
  it("同じキーが 1 件だけ_繰り返しに含めない(偶発として流す)", () => {
    expect(findRepeats([candidate()])).toEqual([]);
  });

  it("同じキーがしきい値の件数に達した_繰り返しとして件数と版の数を返す", () => {
    const records = [candidate(), candidate({ version: "v0.46.0" }), candidate({ key: "other-key" })];
    const repeats = findRepeats(records);
    expect(DEFAULT_THRESHOLD).toBe(2);
    expect(repeats).toHaveLength(1);
    expect(repeats[0]).toMatchObject({ key: "stale-input", count: 2, versions: 2 });
  });

  it("しきい値を 3 にした_2 件のキーは含めない", () => {
    expect(findRepeats([candidate(), candidate()], 3)).toEqual([]);
  });

  it("対処済みの印より前の件_数えず、印より後の件だけで数える", () => {
    const records: InboxRecord[] = [
      candidate(),
      candidate(),
      { type: "closed", at: "t", key: "stale-input", ref: "#341" },
      candidate(),
    ];
    expect(findRepeats(records)).toEqual([]);
    expect(openByKey(records).get("stale-input")).toHaveLength(1);
  });

  it("件数が違う複数のキー_件数の多い順に並べる", () => {
    const records = [
      candidate({ key: "aa-key" }),
      candidate({ key: "aa-key" }),
      candidate({ key: "bb-key" }),
      candidate({ key: "bb-key" }),
      candidate({ key: "bb-key" }),
    ];
    expect(findRepeats(records).map((r) => r.key)).toEqual(["bb-key", "aa-key"]);
  });
});

describe("formatIssueDraft", () => {
  const repeat = findRepeats([
    candidate({ promote: "lessons" }),
    candidate({ version: "v0.46.0", who: "main", cause: "ignored", promote: "mechanical" }),
  ])[0];

  it("繰り返しの種類_1 行目が Conventional Commits の題で、2 行目が空行の下書きになる", () => {
    const lines = formatIssueDraft(repeat as NonNullable<typeof repeat>).split("\n");
    expect(lines[0]).toMatch(/^# chore: .+\(stale-input\)/);
    expect(lines[1]).toBe("");
  });

  it("下書き_版の番号の行を含まず、件数と昇格先の候補を書く", () => {
    const text = formatIssueDraft(repeat as NonNullable<typeof repeat>);
    expect(text).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(text).toContain("2 件");
    expect(text).toContain("機械検査・テスト・フック");
  });
});

describe("addDraftEntries", () => {
  it("一覧が空_新規でラベル lessons の項目を足し、マイルストーンは付けない", () => {
    const result = addDraftEntries([], [draftFileName("stale-input")]);
    expect(result).toEqual({
      entries: [{ action: "create", file: "lessons-stale-input.md", labels: [LESSONS_LABEL] }],
      added: ["lessons-stale-input.md"],
      skipped: [],
    });
  });

  it("一覧に同じ file の項目がある_書き換えず、足さずに skipped へ挙げる", () => {
    const existing = { action: "create", file: "lessons-stale-input.md", milestone: "v0.80.0", labels: ["chore"] };
    const result = addDraftEntries([existing], ["lessons-stale-input.md", "lessons-other-key.md"]);
    expect(result?.entries[0]).toBe(existing);
    expect(result?.entries).toHaveLength(2);
    expect(result?.added).toEqual(["lessons-other-key.md"]);
    expect(result?.skipped).toEqual(["lessons-stale-input.md"]);
  });

  it("一覧に別の項目がある_その項目を残して、末尾に足す", () => {
    const other = { action: "edit", file: "5-existing.md", number: 5 };
    const result = addDraftEntries([other], ["lessons-stale-input.md"]);
    expect(result?.entries[0]).toBe(other);
    expect(result?.entries[1]).toMatchObject({ file: "lessons-stale-input.md" });
  });

  it("一覧が配列でない_足さずに null を返す", () => {
    expect(addDraftEntries({}, ["lessons-stale-input.md"])).toBeNull();
    expect(addDraftEntries(null, ["lessons-stale-input.md"])).toBeNull();
  });

  it("元の一覧_変えない", () => {
    const manifest: unknown[] = [];
    addDraftEntries(manifest, ["lessons-stale-input.md"]);
    expect(manifest).toEqual([]);
  });

  it("足した項目にマイルストーンを付ける_一覧の検査に通り、封印にラベル lessons が入る", () => {
    const [entry] = addDraftEntries([], ["lessons-stale-input.md"])?.entries ?? [];
    const withMilestone = { ...(entry as Record<string, unknown>), milestone: "v0.80.0" };
    expect(validateManifest([withMilestone])).toEqual([]);
    const sealed = sealInput(withMilestone as Parameters<typeof sealInput>[0], "hash");
    expect(sealed).toContain(LESSONS_LABEL);
    expect(sealInput({ ...(withMilestone as Parameters<typeof sealInput>[0]), labels: [] }, "hash")).not.toBe(sealed);
  });

  it("足した項目にマイルストーンを付けない_一覧の検査が、マイルストーンかラベル later を求めて止める", () => {
    const [entry] = addDraftEntries([], ["lessons-stale-input.md"])?.entries ?? [];
    expect(validateManifest([entry])).toHaveLength(1);
  });
});

describe("draftFileName", () => {
  it("種類のキー_lessons- を前に付けた下書きのファイル名にする", () => {
    expect(draftFileName("stale-input")).toBe("lessons-stale-input.md");
  });
});

describe("closedMarks", () => {
  it("対処済みの印がある_キーと行き先と日付を、記録した順に返す", () => {
    const records: InboxRecord[] = [
      candidate(),
      { type: "closed", at: "2026-10-20T01:02:03.000Z", key: "stale-input", ref: "#341" },
      candidate({ key: "other-key" }),
      { type: "closed", at: "2026-10-25T00:00:00.000Z", key: "other-key", ref: "#350" },
    ];
    expect(closedMarks(records)).toEqual([
      { key: "stale-input", ref: "#341", date: "2026-10-20" },
      { key: "other-key", ref: "#350", date: "2026-10-25" },
    ]);
  });

  it("対処していないキーだけ_空を返す", () => {
    expect(closedMarks([candidate(), candidate({ key: "other-key" })])).toEqual([]);
  });

  it("同じキーを 2 回対処済みにした_両方の行き先を返す", () => {
    const records: InboxRecord[] = [
      candidate(),
      { type: "closed", at: "2026-10-20T00:00:00.000Z", key: "stale-input", ref: "#341" },
      candidate(),
      { type: "closed", at: "2026-10-25T00:00:00.000Z", key: "stale-input", ref: "#350" },
    ];
    expect(closedMarks(records).map((m) => m.ref)).toEqual(["#341", "#350"]);
  });
});

describe("strongestPromotion", () => {
  it("昇格先の候補が分かれた_強い方を採る", () => {
    expect(strongestPromotion([candidate({ promote: "lessons" }), candidate({ promote: "skill" })])).toBe("skill");
  });
});

describe("versionOfBranch", () => {
  it("ブランチ名の末尾に版がある_その版を返す", () => {
    expect(versionOfBranch("feat/#340-v0.45.0")).toBe("v0.45.0");
  });

  it("ブランチ名に版がない_unknown を返す", () => {
    expect(versionOfBranch("main")).toBe("unknown");
  });
});

describe("summarize と置き場", () => {
  it("対処済みの印を含む受け箱_候補だけを分類ごとに数える", () => {
    const records: InboxRecord[] = [
      candidate(),
      candidate({ who: "main", cause: "ignored" }),
      { type: "closed", at: "t", key: "stale-input", ref: "#1" },
    ];
    expect(summarize(records)).toEqual({
      who: { subagent: 1, main: 1 },
      cause: { unchecked: 1, ignored: 1 },
      promote: { mechanical: 2 },
    });
  });

  it("共有領域のパス_.git の共通ディレクトリの下に置く", () => {
    expect(inboxPath("/repo/.git")).toBe("/repo/.git/mokumoku-lessons-inbox.jsonl");
  });
});
