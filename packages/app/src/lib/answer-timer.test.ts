import { describe, expect, it } from "vitest";
import { createTimer, elapsedTimes, setVisible, showQuestion } from "./answer-timer.ts";
import { MAX_ANSWER_TIME_MS } from "./storage.ts";

describe("回答時間", () => {
  it("表示している問題の時間を数え_問題を移ると_前の問題に足し込む", () => {
    let timer = showQuestion(createTimer([]), 0, true, 1_000);
    timer = showQuestion(timer, 1, true, 6_000);
    expect(elapsedTimes(timer, 2, 8_000)).toEqual([5_000, 2_000]);
  });

  it("タブが隠れている間は数えない", () => {
    let timer = showQuestion(createTimer([]), 0, true, 0);
    timer = setVisible(timer, false, 3_000);
    // 隠れている 60 秒は数えない
    timer = setVisible(timer, true, 63_000);
    expect(elapsedTimes(timer, 1, 65_000)).toEqual([5_000]);
  });

  it("隠れた状態で問題を表示した_見えるまで数えない", () => {
    let timer = showQuestion(createTimer([]), 0, false, 0);
    expect(elapsedTimes(timer, 1, 10_000)).toEqual([0]);
    timer = setVisible(timer, true, 10_000);
    expect(elapsedTimes(timer, 1, 12_000)).toEqual([2_000]);
  });

  it("戻って同じ問題を見た_時間を足していく", () => {
    let timer = showQuestion(createTimer([]), 0, true, 0);
    timer = showQuestion(timer, 1, true, 1_000);
    timer = showQuestion(timer, 0, true, 2_000);
    expect(elapsedTimes(timer, 2, 4_000)).toEqual([3_000, 1_000]);
  });

  it("再開_保存していた時間から続けて数える", () => {
    const timer = showQuestion(createTimer([7_000, 0]), 0, true, 0);
    expect(elapsedTimes(timer, 2, 1_000)).toEqual([8_000, 0]);
  });

  it("上限を超えない_時計が戻っても負にならない", () => {
    const timer = showQuestion(createTimer([MAX_ANSWER_TIME_MS - 10]), 0, true, 0);
    expect(elapsedTimes(timer, 1, 1_000)).toEqual([MAX_ANSWER_TIME_MS]);
    const back = showQuestion(createTimer([]), 0, true, 5_000);
    expect(elapsedTimes(back, 1, 1_000)).toEqual([0]);
  });

  it("隠れるのが続いても_二重に足さない", () => {
    let timer = showQuestion(createTimer([]), 0, true, 0);
    timer = setVisible(timer, false, 1_000);
    timer = setVisible(timer, false, 5_000);
    timer = setVisible(timer, true, 9_000);
    timer = setVisible(timer, true, 9_500);
    expect(elapsedTimes(timer, 1, 10_000)).toEqual([2_000]);
  });
});
