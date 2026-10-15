import { afterEach, describe, expect, it, vi } from "vitest";
import { API_FAILURE_EVENT, logApiFailure } from "./log.ts";

const MARKER = "marker-7f3a";

function capture() {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => spy.mock.calls.map((call) => call.map(String).join(" "));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API の失敗の記録", () => {
  it("例外で 503 を返す_経路・状態・例外の名前だけを 1 行の JSON で出す", () => {
    const lines = capture();
    const error = new TypeError("detail");
    logApiFailure(new Request("https://example.com/api/history/results?examCode=EX-SMP-XX"), 503, error);
    expect(lines()).toHaveLength(1);
    expect(JSON.parse(lines()[0] ?? "")).toEqual({
      event: API_FAILURE_EVENT,
      path: "/api/history/results",
      status: 503,
      error: "TypeError",
    });
  });

  it("例外のメッセージ・スタック・問い合わせに目印がある_出力に目印が現れない", () => {
    const lines = capture();
    const error = new Error(`failed for ${MARKER}`);
    error.stack = `Error: ${MARKER}\n    at somewhere (${MARKER}.ts:1:1)`;
    logApiFailure(new Request(`https://example.com/api/history/results?examCode=${MARKER}`), 503, error);
    expect(lines().join("\n")).not.toContain(MARKER);
  });

  it("形の外れた経路と例外の名前_固定の値に置き換える", () => {
    const lines = capture();
    const named = new Error("detail");
    named.name = `Bad name ${MARKER}`;
    logApiFailure(new Request(`https://example.com/exams/%E3%81%82${MARKER}`), 503, named);
    logApiFailure(new Request("https://example.com/api/admin/users"), 503, { name: MARKER });
    const [first, second] = lines().map((line) => JSON.parse(line));
    expect(first).toMatchObject({ path: "(other)", error: "unknown" });
    expect(second).toMatchObject({ path: "/api/admin/users", error: "unknown" });
    expect(lines().join("\n")).not.toContain(MARKER);
  });
});
