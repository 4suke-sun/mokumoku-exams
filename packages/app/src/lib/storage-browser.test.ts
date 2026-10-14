// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { browserStore, loadSession, saveSession } from "./storage.ts";

// ページの読み込みで 1 回だけ動く処理を確かめるので、このファイルでは、最初の browserStore() の前に端末の値を置く
const OWNER = "0123456789abcdef";

describe("ブラウザの保存先", () => {
  it("ページの読み込みの最初に_印のない資格ごとの記録を読まずに消し_持ち主のある記録と表示の設定は残す", () => {
    const session = {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: {},
      index: 0,
      startedAt: "2026-10-01T00:00:00.000Z",
    };
    localStorage.setItem("mokumoku:v1:session:TEST", JSON.stringify(session));
    localStorage.setItem("mokumoku:v1:sections:TEST", JSON.stringify({ examCode: "TEST", best: {} }));
    localStorage.setItem(`mokumoku:v1:${OWNER}:results:TEST`, "[]");
    localStorage.setItem("mokumoku:v1:settings", JSON.stringify({ shuffleChoices: true }));

    const store = browserStore();

    expect(loadSession(store, "TEST")).toBeNull();
    expect(Object.keys(localStorage).sort()).toEqual(
      [`mokumoku:v1:${OWNER}:results:TEST`, "mokumoku:v1:settings"].sort(),
    );
    expect(saveSession(store, session)).toBe(true);
    expect(localStorage.getItem(`mokumoku:v1:${OWNER}:session:TEST`)).not.toBeNull();
  });
});
