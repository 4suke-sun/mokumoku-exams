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

/** テスト用の、1 ページに 1 行の文字を置いた最小の PDF(相互参照表の位置を正しく計算する) */
export function syntheticPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
