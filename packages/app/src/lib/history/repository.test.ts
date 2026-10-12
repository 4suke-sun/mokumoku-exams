import { describe, expect, it } from "vitest";
import type { Result } from "@/lib/storage.ts";
import {
  createDynamoRepository,
  createMemoryRepository,
  getHistoryRepository,
  type HistoryRepository,
  RESULTS_PAGE_SIZE,
  resultKey,
  userKey,
} from "./repository.ts";
import { fakeTable } from "./table-double.ts";

const result = (examCode: string, minute: number, extra: Partial<Result> = {}): Result => ({
  examCode,
  questionIds: ["Q-0001", "Q-0002"],
  answers: { "Q-0001": ["A"] },
  finishedAt: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
  ...extra,
});

describe("DynamoDB の履歴", () => {
  it("結果を保存する_PK は利用者の sub で SK は資格コードと完了時刻になる", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    const saved = result("SAMPLE", 1);
    await repository.putResult("user-a", saved);
    const [item] = [...items.values()];
    expect(item?.PK).toBe("USER#user-a");
    expect(item?.SK).toBe(`RESULT#SAMPLE#${saved.finishedAt}`);
    expect(userKey("user-a")).toBe("USER#user-a");
    expect(resultKey(saved)).toBe(`RESULT#SAMPLE#${saved.finishedAt}`);
  });

  it("結果を取得する_自分の分だけを新しい順に返す", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    await repository.putResult("user-a", result("SAMPLE", 3));
    await repository.putResult("user-b", result("SAMPLE", 2));
    const found = await repository.listResults("user-a", "SAMPLE");
    expect(found.map((r) => r.finishedAt)).toEqual([result("SAMPLE", 3).finishedAt, result("SAMPLE", 1).finishedAt]);
    expect(await repository.listResults("user-c", "SAMPLE")).toEqual([]);
  });

  it("資格コードが前方一致する別の資格_混ざらない", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("EXAM1", 1));
    await repository.putResult("user-a", result("EXAM10", 2));
    expect((await repository.listResults("user-a", "EXAM1")).map((r) => r.examCode)).toEqual(["EXAM1"]);
  });

  it("同じ完了時刻の結果を繰り返し保存する_重複しない", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    await repository.putResult("user-a", result("SAMPLE", 1));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("結果は件数の上限なしで残し_一覧は新しい順にページで返す", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    const total = RESULTS_PAGE_SIZE + 5;
    for (let minute = 0; minute < total; minute++) await repository.putResult("user-a", result("SAMPLE", minute));
    expect(items.size).toBe(total);
    const first = await repository.listResults("user-a", "SAMPLE");
    expect(first).toHaveLength(RESULTS_PAGE_SIZE);
    expect(first[0]?.finishedAt).toBe(result("SAMPLE", total - 1).finishedAt);
    const rest = await repository.listResults("user-a", "SAMPLE", { before: first.at(-1)?.finishedAt });
    expect(rest.map((r) => r.finishedAt)).toEqual([4, 3, 2, 1, 0].map((m) => result("SAMPLE", m).finishedAt));
  });

  it("新しく作ったときだけ true を返す", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    expect(await repository.putResult("user-a", result("SAMPLE", 1))).toBe(true);
    expect(await repository.putResult("user-a", result("SAMPLE", 1))).toBe(false);
  });

  it("1 回分の結果_自分の分だけを返し_なければ null", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    const saved = result("SAMPLE", 1);
    await repository.putResult("user-a", saved);
    expect(await repository.getResult("user-a", "SAMPLE", saved.finishedAt)).toEqual(saved);
    expect(await repository.getResult("user-b", "SAMPLE", saved.finishedAt)).toBeNull();
    expect(await repository.getResult("user-a", "OTHER", saved.finishedAt)).toBeNull();
  });

  it("保存した項目が壊れている_その項目は返さない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("USER#user-a|RESULT#SAMPLE#2026-10-11T12:00:00.000Z", {
      PK: "USER#user-a",
      SK: "RESULT#SAMPLE#2026-10-11T12:00:00.000Z",
      examCode: "SAMPLE",
    });
    await repository.putResult("user-a", result("SAMPLE", 5));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("結果の保存と取得に使う操作は_保存・取得・問い合わせだけで_スキャンも削除も使わない", async () => {
    const { sent, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    for (let minute = 0; minute <= 12; minute++) await repository.putResult("user-a", result("SAMPLE", minute));
    await repository.listResults("user-a", "SAMPLE");
    await repository.getResult("user-a", "SAMPLE", result("SAMPLE", 1).finishedAt);
    const names = new Set(sent.map((c) => (c as { constructor: { name: string } }).constructor.name));
    expect([...names].sort()).toEqual(["GetCommand", "PutCommand", "QueryCommand"]);
  });
});

describe("DynamoDB のブックマークと復習プール", () => {
  it("ブックマーク_SK は資格と問題 ID で_自分の資格の分だけを返す", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.setBookmark("user-a", "SAMPLE", "SAMPLE-0002", true);
    await repository.setBookmark("user-a", "SAMPLE", "SAMPLE-0001", true);
    await repository.setBookmark("user-a", "SAMPLE2", "SAMPLE2-0001", true);
    await repository.setBookmark("user-b", "SAMPLE", "SAMPLE-0003", true);
    expect([...items.values()].map((i) => `${i.PK} ${i.SK}`)).toContain("USER#user-a BOOKMARK#SAMPLE#SAMPLE-0002");
    expect(await repository.listBookmarks("user-a", "SAMPLE")).toEqual(["SAMPLE-0001", "SAMPLE-0002"]);
    await repository.setBookmark("user-a", "SAMPLE", "SAMPLE-0001", false);
    expect(await repository.listBookmarks("user-a", "SAMPLE")).toEqual(["SAMPLE-0002"]);
  });

  it("復習プール_間違えた問題を入れ_2 回続けて正解でマスターにし_結果の項目とは混ざらない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    const at = "2026-10-11T12:00:00.000Z";
    await repository.updateReview("user-a", "SAMPLE", { wrong: ["SAMPLE-0001", "SAMPLE-0002"], correct: [], at });
    await repository.updateReview("user-a", "SAMPLE", { wrong: [], correct: ["SAMPLE-0001", "SAMPLE-0003"], at });
    // 1 回の正解では、まだ残る。入っていない問題(0003)は、入れない
    expect(await repository.listReview("user-a", "SAMPLE")).toEqual(["SAMPLE-0001", "SAMPLE-0002"]);
    await repository.updateReview("user-a", "SAMPLE", { wrong: [], correct: ["SAMPLE-0001"], at });
    expect(await repository.listReview("user-a", "SAMPLE")).toEqual(["SAMPLE-0002"]);
    expect(await repository.listReview("user-b", "SAMPLE")).toEqual([]);
    expect(items.get("USER#user-a|REVIEW#SAMPLE#SAMPLE-0002")?.wrongAt).toBe(at);
    expect(await repository.listReviewItems("user-a")).toEqual([
      { examCode: "SAMPLE", questionId: "SAMPLE-0001", streak: 2, mastered: true },
      { examCode: "SAMPLE", questionId: "SAMPLE-0002", streak: 0, mastered: false },
    ]);
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("壊れた SK_問題 ID の形でないものは返さない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("x", { PK: "USER#user-a", SK: "BOOKMARK#SAMPLE#broken" });
    expect(await repository.listBookmarks("user-a", "SAMPLE")).toEqual([]);
  });

  it("問題の多い結果_同時に送る書き込みは 10 件まで", async () => {
    let inFlight = 0;
    let peak = 0;
    const { client } = fakeTable();
    const slow = {
      async send(command: unknown) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return client.send(command);
      },
    };
    const repository = createDynamoRepository({ tableName: "table-example", client: slow });
    const ids = Array.from({ length: 35 }, (_, i) => `SAMPLE-${String(i + 1).padStart(4, "0")}`);
    await repository.updateReview("user-a", "SAMPLE", { wrong: ids, correct: [], at: "2026-10-11T12:00:00.000Z" });
    expect(peak).toBe(10);
    expect(await repository.listReview("user-a", "SAMPLE")).toHaveLength(35);
  });
});

describe("DynamoDB の日ごとの学習量と目標日", () => {
  it("新しい結果_完了した日(日本時間)の項目に足し_同じ結果の送り直しでは足さない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    const late = result("SAMPLE", 0, { finishedAt: "2026-10-11T15:00:00.000Z" });
    await repository.putResult("user-a", late, { answered: 2, correct: 1 });
    await repository.putResult("user-a", late, { answered: 2, correct: 1 });
    await repository.putResult("user-a", result("SAMPLE", 5, { finishedAt: "2026-10-12T01:00:00.000Z" }), {
      answered: 3,
      correct: 3,
    });
    expect(items.get("USER#user-a|DAY#SAMPLE#2026-10-12")).toMatchObject({
      type: "day",
      examCode: "SAMPLE",
      date: "2026-10-12",
      answered: 5,
      correct: 4,
    });
    expect(await repository.listDays("user-a", "SAMPLE")).toEqual([{ date: "2026-10-12", answered: 5, correct: 4 }]);
    expect(await repository.listDays("user-b", "SAMPLE")).toEqual([]);
  });

  it("学習量を渡さない・解いた問題が 0_日ごとの項目を作らない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    await repository.putResult("user-a", result("SAMPLE", 2), { answered: 0, correct: 0 });
    expect([...items.keys()].some((key) => key.includes("DAY#"))).toBe(false);
  });

  it("日ごとの学習量_日付の順に返し_資格が前方一致する別の資格や壊れた項目は混ざらない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    const at = (iso: string) => result("SAMPLE", 0, { finishedAt: iso });
    await repository.putResult("user-a", at("2026-10-12T01:00:00.000Z"), { answered: 1, correct: 0 });
    await repository.putResult("user-a", at("2026-10-01T01:00:00.000Z"), { answered: 2, correct: 2 });
    await repository.putResult("user-a", result("SAMPLE1", 0), { answered: 4, correct: 4 });
    items.set("broken-1", { PK: "USER#user-a", SK: "DAY#SAMPLE#2026-02-30", answered: 1, correct: 0 });
    items.set("broken-2", { PK: "USER#user-a", SK: "DAY#SAMPLE#2026-10-05", answered: 1, correct: 2 });
    items.set("broken-3", { PK: "USER#user-a", SK: "DAY#SAMPLE#2026-10-06", answered: "1", correct: 0 });
    expect(await repository.listDays("user-a", "SAMPLE")).toEqual([
      { date: "2026-10-01", answered: 2, correct: 2 },
      { date: "2026-10-12", answered: 1, correct: 0 },
    ]);
  });

  it("目標日_SK は資格ごとに 1 つで_上書きでき_消せる", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    expect(await repository.getGoal("user-a", "SAMPLE")).toBeNull();
    await repository.setGoal("user-a", "SAMPLE", "2026-12-01");
    await repository.setGoal("user-a", "SAMPLE", "2026-12-20");
    expect(items.get("USER#user-a|GOAL#SAMPLE")).toMatchObject({
      type: "goal",
      examCode: "SAMPLE",
      date: "2026-12-20",
    });
    expect(await repository.getGoal("user-a", "SAMPLE")).toBe("2026-12-20");
    expect(await repository.getGoal("user-b", "SAMPLE")).toBeNull();
    await repository.setGoal("user-a", "SAMPLE", null);
    expect(await repository.getGoal("user-a", "SAMPLE")).toBeNull();
  });

  it("表示の設定_PK は利用者の sub で SK は PREFS の 1 件_上書きでき_別の利用者と混ざらない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    expect(await repository.getPrefs("user-a")).toBeNull();
    await repository.setPrefs("user-a", { theme: "dark", style: "simple", shuffleChoices: true });
    await repository.setPrefs("user-a", { theme: "light", style: "rich", shuffleChoices: false });
    await repository.setPrefs("user-b", { theme: "dark", style: "rich", shuffleChoices: false });
    expect(items.get("USER#user-a|PREFS")).toMatchObject({
      PK: "USER#user-a",
      SK: "PREFS",
      type: "prefs",
      theme: "light",
      style: "rich",
      shuffleChoices: false,
    });
    expect(await repository.getPrefs("user-a")).toEqual({ theme: "light", style: "rich", shuffleChoices: false });
    expect(await repository.getPrefs("user-b")).toEqual({ theme: "dark", style: "rich", shuffleChoices: false });
    expect(await repository.getPrefs("user-c")).toBeNull();
    // 設定の項目は、結果などの問い合わせ(SK の前方一致)に入らない
    expect(await repository.listResults("user-a", "SAMPLE")).toEqual([]);
  });

  it("壊れた表示の設定_保存していないものとして扱う", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("USER#user-a|PREFS", {
      PK: "USER#user-a",
      SK: "PREFS",
      theme: "blue",
      style: "rich",
      shuffleChoices: false,
    });
    expect(await repository.getPrefs("user-a")).toBeNull();
    items.set("USER#user-a|PREFS", { PK: "USER#user-a", SK: "PREFS", theme: "dark" });
    expect(await repository.getPrefs("user-a")).toBeNull();
  });

  it("壊れた目標日_ないものとして扱う", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("USER#user-a|GOAL#SAMPLE", { PK: "USER#user-a", SK: "GOAL#SAMPLE", date: "someday" });
    expect(await repository.getGoal("user-a", "SAMPLE")).toBeNull();
  });

  it("使う操作は_保存・取得・更新・問い合わせ・削除だけで_スキャンは使わない", async () => {
    const { sent, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1), { answered: 1, correct: 1 });
    await repository.listDays("user-a", "SAMPLE");
    await repository.setGoal("user-a", "SAMPLE", "2026-12-20");
    await repository.getGoal("user-a", "SAMPLE");
    await repository.setGoal("user-a", "SAMPLE", null);
    const names = new Set(sent.map((c) => (c as { constructor: { name: string } }).constructor.name));
    expect([...names].sort()).toEqual(["DeleteCommand", "GetCommand", "PutCommand", "QueryCommand", "UpdateCommand"]);
  });
});

describe("メモリ上の履歴", () => {
  it("利用者ごとに分かれ_結果は残し_一覧はページで返す", async () => {
    const repository = createMemoryRepository();
    for (let minute = 0; minute <= RESULTS_PAGE_SIZE; minute++)
      await repository.putResult("user-a", result("SAMPLE", minute));
    await repository.putResult("user-b", result("SAMPLE", 0));
    const first = await repository.listResults("user-a", "SAMPLE");
    expect(first).toHaveLength(RESULTS_PAGE_SIZE);
    expect(await repository.listResults("user-a", "SAMPLE", { before: first.at(-1)?.finishedAt })).toHaveLength(1);
    expect(await repository.listResults("user-b", "SAMPLE")).toHaveLength(1);
  });

  it("表示の設定_利用者ごとに分かれ_上書きできる", async () => {
    const repository = createMemoryRepository();
    expect(await repository.getPrefs("user-a")).toBeNull();
    await repository.setPrefs("user-a", { theme: "dark", style: "simple", shuffleChoices: true });
    await repository.setPrefs("user-b", { theme: "light", style: "rich", shuffleChoices: false });
    expect(await repository.getPrefs("user-a")).toEqual({ theme: "dark", style: "simple", shuffleChoices: true });
    expect(await repository.getPrefs("user-b")).toEqual({ theme: "light", style: "rich", shuffleChoices: false });
  });

  it("日ごとの学習量と目標日_DynamoDB の実装と同じに振る舞う", async () => {
    const repository = createMemoryRepository();
    const late = result("SAMPLE", 0, { finishedAt: "2026-10-11T15:00:00.000Z" });
    await repository.putResult("user-a", late, { answered: 2, correct: 1 });
    await repository.putResult("user-a", late, { answered: 2, correct: 1 });
    await repository.putResult("user-a", result("SAMPLE", 1), { answered: 1, correct: 1 });
    expect(await repository.listDays("user-a", "SAMPLE")).toEqual([
      { date: "2026-10-11", answered: 1, correct: 1 },
      { date: "2026-10-12", answered: 2, correct: 1 },
    ]);
    expect(await repository.listDays("user-b", "SAMPLE")).toEqual([]);
    await repository.setGoal("user-a", "SAMPLE", "2026-12-20");
    expect(await repository.getGoal("user-a", "SAMPLE")).toBe("2026-12-20");
    expect(await repository.getGoal("user-b", "SAMPLE")).toBeNull();
    await repository.setGoal("user-a", "SAMPLE", null);
    expect(await repository.getGoal("user-a", "SAMPLE")).toBeNull();
  });
});

describe("getHistoryRepository", () => {
  it("本番の設定では_AUTH_FAKE があってもメモリを使わず_設定が足りなければ失敗する", () => {
    expect(() => getHistoryRepository({ NODE_ENV: "production", AUTH_FAKE: "1" })).toThrow();
  });

  it("手元の開発で AUTH_FAKE=1 のとき_メモリ上の保存先を返す", async () => {
    const repository = getHistoryRepository({ NODE_ENV: "development", AUTH_FAKE: "1" });
    await repository.putResult("user-a", result("SAMPLE", 1));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("設定が揃っていれば_DynamoDB の実装を返す", () => {
    expect(
      getHistoryRepository({ NODE_ENV: "production", HISTORY_TABLE_NAME: "t", AWS_REGION: "us-east-1" }),
    ).toBeDefined();
  });
});

/** DynamoDB とメモリの、両方の実装で同じに振る舞うこと */
describe.each([
  [
    "DynamoDB",
    () => createDynamoRepository({ tableName: "table-example", client: fakeTable({ queryPageSize: 2 }).client }),
  ],
  ["メモリ", () => createMemoryRepository()],
] as [string, () => HistoryRepository][])("%s の、問題ごとの集計と復習", (_name, create) => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString();

  it("解答回数を数え_直近の正誤を完了時刻の順に 5 回分残し_同じ時刻は二重に数えない", async () => {
    const repository = create();
    for (let minute = 0; minute < 7; minute++) {
      await repository.updateStats(
        "user-a",
        "SAMPLE",
        [{ questionId: "SAMPLE-0001", correct: minute % 2 === 0 }],
        at(minute),
      );
    }
    // 古い結果をあとから送っても、時刻の順に並べる。同じ時刻は数えない
    await repository.updateStats("user-a", "SAMPLE", [{ questionId: "SAMPLE-0001", correct: false }], at(6));
    await repository.updateStats("user-a", "SAMPLE", [{ questionId: "SAMPLE-0002", correct: true }], at(1));
    expect(await repository.listStats("user-a", "SAMPLE")).toEqual([
      { questionId: "SAMPLE-0001", count: 7, recent: [true, false, true, false, true] },
      { questionId: "SAMPLE-0002", count: 1, recent: [true] },
    ]);
    expect(await repository.listStats("user-b", "SAMPLE")).toEqual([]);
    expect(await repository.listStats("user-a", "OTHER")).toEqual([]);
  });

  it("復習_不正解で連続を 0 に戻し_マスター済みは数えたまま_手で外せる", async () => {
    const repository = create();
    const change = (wrong: string[], correct: string[]) => ({ wrong, correct, at: at(0) });
    await repository.updateReview("user-a", "SAMPLE", change(["SAMPLE-0001", "SAMPLE-0002"], []));
    await repository.updateReview("user-a", "SAMPLE", change([], ["SAMPLE-0001"]));
    await repository.updateReview("user-a", "SAMPLE", change(["SAMPLE-0001"], []));
    await repository.updateReview("user-a", "SAMPLE", change([], ["SAMPLE-0001"]));
    expect((await repository.listReviewItems("user-a")).find((i) => i.questionId === "SAMPLE-0001")?.streak).toBe(1);
    await repository.updateReview("user-a", "OTHER", change(["OTHER-0001"], []));
    await repository.removeReview("user-a", "SAMPLE", "SAMPLE-0002");
    await repository.removeReview("user-b", "SAMPLE", "SAMPLE-0001");
    expect(await repository.listReviewItems("user-a")).toEqual([
      { examCode: "OTHER", questionId: "OTHER-0001", streak: 0, mastered: false },
      { examCode: "SAMPLE", questionId: "SAMPLE-0001", streak: 1, mastered: false },
    ]);
    expect(await repository.listReviewItems("user-b")).toEqual([]);
  });
});

describe("DynamoDB の古い形の保存", () => {
  it("連続正解の数がない復習の項目_連続 0・未マスターとして読み_正解で 1 になる", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("USER#user-a|REVIEW#SAMPLE#SAMPLE-0001", {
      PK: "USER#user-a",
      SK: "REVIEW#SAMPLE#SAMPLE-0001",
      type: "review",
      examCode: "SAMPLE",
      questionId: "SAMPLE-0001",
      wrongAt: "2026-10-01T00:00:00.000Z",
    });
    expect(await repository.listReview("user-a", "SAMPLE")).toEqual(["SAMPLE-0001"]);
    expect(await repository.listReviewItems("user-a")).toEqual([
      { examCode: "SAMPLE", questionId: "SAMPLE-0001", streak: 0, mastered: false },
    ]);
    await repository.updateReview("user-a", "SAMPLE", {
      wrong: [],
      correct: ["SAMPLE-0001"],
      at: "2026-10-02T00:00:00.000Z",
    });
    expect(items.get("USER#user-a|REVIEW#SAMPLE#SAMPLE-0001")?.streak).toBe(1);
  });
});
