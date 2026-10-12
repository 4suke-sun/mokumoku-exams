import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  heatLevel,
  heatmapWeeks,
  isValidDate,
  jstDate,
  mergeDays,
  type StudyDay,
  streakDays,
} from "./study-days.ts";

const day = (date: string, answered = 1): StudyDay => ({ date, answered, correct: 0 });

describe("日本時間の日付", () => {
  it("UTC で前日の 15 時より前_同じ日付で_15 時ちょうどから翌日になる", () => {
    expect(jstDate("2026-10-10T14:59:59.999Z")).toBe("2026-10-10");
    expect(jstDate("2026-10-10T15:00:00.000Z")).toBe("2026-10-11");
    expect(jstDate(Date.parse("2026-12-31T15:00:00.000Z"))).toBe("2027-01-01");
  });

  it("実在しない日付と形の違う日付_正しくないとみなす", () => {
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true);
    for (const value of ["2026-02-29", "2026-13-01", "2026-1-1", "2026/10/11", "", "2026-10-11T00:00"]) {
      expect(isValidDate(value), value).toBe(false);
    }
  });

  it("日数の加減と差_月や年をまたいでも数えられる", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-11", "2026-10-11")).toBe(0);
    expect(daysBetween("2026-10-11", "2027-01-01")).toBe(82);
    expect(daysBetween("2026-10-11", "2026-10-01")).toBe(-10);
  });
});

describe("連続日数", () => {
  const today = "2026-10-11";

  it("学習した日がない_0 日", () => {
    expect(streakDays([], today)).toBe(0);
  });

  it("今日まで続いている_今日を含めて数える", () => {
    expect(streakDays([day("2026-10-09"), day("2026-10-10"), day("2026-10-11")], today)).toBe(3);
  });

  it("昨日まで続いていて今日はまだ_途切れず昨日までを数える", () => {
    expect(streakDays([day("2026-10-09"), day("2026-10-10")], today)).toBe(2);
  });

  it("一昨日で止まっている_0 日", () => {
    expect(streakDays([day("2026-10-08"), day("2026-10-09")], today)).toBe(0);
  });

  it("途中に空いた日がある_空いた日より前は数えない", () => {
    expect(streakDays([day("2026-10-07"), day("2026-10-09"), day("2026-10-10"), day("2026-10-11")], today)).toBe(3);
  });

  it("解いた問題が 0 の日_学習した日とみなさない", () => {
    expect(streakDays([day("2026-10-10"), day("2026-10-11", 0)], today)).toBe(1);
  });
});

describe("ヒートマップ", () => {
  // 2026-10-11 は日曜
  it("12 週分で_最後の週は今日を含み_今日より先は空ける", () => {
    const weeks = heatmapWeeks([day("2026-10-11", 7), day("2026-07-26", 3), day("2026-07-25", 9)], "2026-10-11");
    expect(weeks).toHaveLength(12);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0]?.[0]).toEqual({ date: "2026-07-26", answered: 3 });
    expect(weeks[11]?.[0]).toEqual({ date: "2026-10-11", answered: 7 });
    expect(weeks[11]?.slice(1).map((cell) => cell.answered)).toEqual([null, null, null, null, null, null]);
    expect(weeks[11]?.[6]?.date).toBe("2026-10-17");
    // 範囲より前の日は含まない
    expect(weeks.flat().some((cell) => cell.date === "2026-07-25")).toBe(false);
  });

  it("土曜が今日_最後の週が埋まる", () => {
    const weeks = heatmapWeeks([], "2026-10-17", 2);
    expect(weeks.flat().every((cell) => cell.answered === 0)).toBe(true);
    expect(weeks.map((w) => w.map((cell) => cell.date))).toEqual([
      ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"],
      ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"],
    ]);
  });

  it("濃さ_解いた問題の数で 5 段階に分ける", () => {
    expect([0, 1, 4, 5, 9, 10, 19, 20, 100].map(heatLevel)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("mergeDays", () => {
  it("資格ごとの学習量_日付ごとに足して日付の順にする", () => {
    const merged = mergeDays([
      [
        { date: "2026-10-11", answered: 3, correct: 2 },
        { date: "2026-10-09", answered: 1, correct: 1 },
      ],
      [{ date: "2026-10-11", answered: 5, correct: 1 }],
      [],
    ]);
    expect(merged).toEqual([
      { date: "2026-10-09", answered: 1, correct: 1 },
      { date: "2026-10-11", answered: 8, correct: 3 },
    ]);
  });

  it("どの資格にも学習がない_空", () => {
    expect(mergeDays([[], []])).toEqual([]);
  });
});
