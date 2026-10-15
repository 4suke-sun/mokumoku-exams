import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  type Candidate,
  DEFAULT_THRESHOLD,
  findRepeats,
  formatIssueDraft,
  type InboxRecord,
  inboxPath,
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

  it("版の形が不正な行_読み込まない(書き込み側と同じ検査)", () => {
    const bad = serializeRecord(candidate({ version: "latest" }));
    expect(parseInbox(bad)).toEqual([]);
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
