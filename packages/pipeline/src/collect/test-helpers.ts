// テスト用の偽の通信。外部へは通信せず、決めた応答だけを返す。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.ts";
import type { FetcherDeps } from "./fetcher.ts";
import type { SourceEntry } from "./ledger.ts";

export function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
}

export interface FakeResponse {
  status?: number;
  body?: string | Buffer;
  headers?: Record<string, string>;
  /** 応答を返さず、中断されるまで待つ(タイムアウトの確認) */
  hang?: boolean;
  /** 通信の失敗 */
  error?: boolean;
}

export interface FakeNet {
  deps: FetcherDeps;
  /** 要求された URL の順 */
  requests: string[];
  /** 要求ごとの開始時刻(偽の時計) */
  startTimes: number[];
  /** 送られた User-Agent */
  userAgents: string[];
}

/** URL ごとの応答を返す偽の通信。時計と待ちも偽にして、待った時間を進める */
export function fakeNet(routes: Record<string, FakeResponse>): FakeNet {
  let clock = 0;
  const net: FakeNet = {
    requests: [],
    startTimes: [],
    userAgents: [],
    deps: {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetch: async (input, init) => {
        const url = input.toString();
        net.requests.push(url);
        net.startTimes.push(clock);
        net.userAgents.push(new Headers(init?.headers).get("user-agent") ?? "");
        const route = routes[url] ?? { status: 404, body: "" };
        if (route.error) throw new TypeError("fetch failed");
        if (route.hang) {
          return await new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
        }
        const body = route.body ?? "";
        return new Response(typeof body === "string" ? body : new Uint8Array(body), {
          status: route.status ?? 200,
          headers: route.headers ?? {},
        });
      },
    },
  };
  return net;
}

export const testFetchConfig: Config["fetch"] = {
  perHostIntervalMs: 2000,
  perHostConcurrency: 1,
  maxConcurrency: 4,
  timeoutMs: 50,
  maxBytes: 10_000,
  maxRedirects: 2,
  userAgent: "mokumoku-exams-pipeline/1.0 (source collector)",
};

export const ROBOTS_OK: FakeResponse = { status: 404 };

const CODE = "AWS-AIB-C01";

/** 台帳の出典の項目(テスト用の既定値) */
export function entry(overrides: Partial<SourceEntry> = {}): SourceEntry {
  return {
    url: "https://docs.aws.amazon.com/guide/a.html",
    kind: "official-doc",
    target: { examCode: CODE, edition: "C01" },
    fetchedAt: "2026-10-01",
    contentHash: "a".repeat(64),
    updatedAt: null,
    status: "active",
    checks: [],
    claims: [],
    ...overrides,
  };
}
