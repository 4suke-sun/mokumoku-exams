import { createHash } from "node:crypto";
import type { Config } from "../config.ts";
import { sourceUrlReason } from "../contract.ts";
import { isAllowed, type RobotsRules, rulesFor } from "./robots.ts";

/**
 * 出典の取得器。許可したドメインの https だけを、相手に負担をかけない間隔で取得する。
 * 失敗は理由コードで返し、本文や URL の値を誤りの文に含めない。保存は呼び出し側が行う。
 */

export type FetchReason =
  | "not-allowed"
  | "timeout"
  | "too-large"
  | "too-many-redirects"
  | "robots-disallowed"
  | "robots-unreachable"
  | "http-error"
  | "network-error";

export type FetchResult =
  | {
      ok: true;
      /** リダイレクトのあとの URL */
      finalUrl: string;
      body: Buffer;
      /** 本文の sha256(16 進) */
      hash: string;
      contentType: string | null;
      /** Last-Modified ヘッダー(更新日の手がかり) */
      lastModified: string | null;
    }
  | { ok: false; reason: FetchReason; status?: number };

export interface FetcherDeps {
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const defaultDeps: FetcherDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 同時に動かす数の上限 */
class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly limit: number;
  constructor(limit: number) {
    this.limit = limit;
  }
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((r) => this.waiting.push(r));
  }
  release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}

class HostLimiter {
  private readonly semaphore: Semaphore;
  private nextStart = 0;
  private readonly intervalMs: number;
  private readonly deps: FetcherDeps;
  constructor(limit: number, intervalMs: number, deps: FetcherDeps) {
    this.semaphore = new Semaphore(limit);
    this.intervalMs = intervalMs;
    this.deps = deps;
  }
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire();
    try {
      // 開始の時刻を先に予約してから待つ(並んだ取得が同じ時刻に始まらないように)
      const start = Math.max(this.deps.now(), this.nextStart);
      this.nextStart = start + this.intervalMs;
      const wait = start - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
      return await task();
    } finally {
      this.semaphore.release();
    }
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type RawResult =
  | { ok: true; status: number; headers: Headers; body: Buffer }
  | { ok: true; status: number; headers: Headers; body: null }
  | { ok: false; reason: "timeout" | "too-large" | "network-error" };

export class Fetcher {
  private readonly global: Semaphore;
  private readonly hosts = new Map<string, HostLimiter>();
  private readonly robots = new Map<string, Promise<RobotsRules | null>>();
  private readonly options: Config["fetch"];
  private readonly deps: FetcherDeps;

  constructor(options: Config["fetch"], deps: FetcherDeps = defaultDeps) {
    this.options = options;
    this.deps = deps;
    this.global = new Semaphore(options.maxConcurrency);
  }

  private limiter(host: string): HostLimiter {
    let limiter = this.hosts.get(host);
    if (!limiter) {
      limiter = new HostLimiter(this.options.perHostConcurrency, this.options.perHostIntervalMs, this.deps);
      this.hosts.set(host, limiter);
    }
    return limiter;
  }

  /** 1 回の要求。リダイレクトは追わない。本文は上限まで読み、超えたら止める */
  private async request(url: URL, readBody: boolean): Promise<RawResult> {
    await this.global.acquire();
    try {
      return await this.limiter(url.hostname).run(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        try {
          const res = await this.deps.fetch(url, {
            redirect: "manual",
            signal: controller.signal,
            headers: { "user-agent": this.options.userAgent },
          });
          if (!readBody || REDIRECT_STATUSES.has(res.status) || res.status >= 400) {
            await res.body?.cancel().catch(() => {});
            return { ok: true, status: res.status, headers: res.headers, body: null };
          }
          const declared = Number(res.headers.get("content-length"));
          if (Number.isFinite(declared) && declared > this.options.maxBytes) {
            await res.body?.cancel().catch(() => {});
            return { ok: false, reason: "too-large" };
          }
          const chunks: Uint8Array[] = [];
          let size = 0;
          const reader = res.body?.getReader();
          while (reader) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > this.options.maxBytes) {
              await reader.cancel().catch(() => {});
              return { ok: false, reason: "too-large" };
            }
            chunks.push(value);
          }
          return { ok: true, status: res.status, headers: res.headers, body: Buffer.concat(chunks) };
        } catch {
          return { ok: false, reason: controller.signal.aborted ? "timeout" : "network-error" };
        } finally {
          clearTimeout(timer);
        }
      });
    } finally {
      this.global.release();
    }
  }

  /**
   * ホストの robots.txt の規則。404 などの 4xx は制限なし、取得できない(5xx・通信の失敗)は null(すべて禁止として扱う)。
   * robots.txt のリダイレクトは追わず、取得できないものとして扱う。
   */
  private rulesForHost(url: URL): Promise<RobotsRules | null> {
    let rules = this.robots.get(url.hostname);
    if (!rules) {
      rules = this.request(new URL(`${url.origin}/robots.txt`), true).then((r) => {
        if (!r.ok) return null;
        if (r.status >= 200 && r.status < 300 && r.body)
          return rulesFor(r.body.toString("utf8"), this.options.userAgent);
        if (r.status >= 400 && r.status < 500) return { allow: [], disallow: [] };
        return null;
      });
      this.robots.set(url.hostname, rules);
    }
    return rules;
  }

  /** 1 つの URL を取得する。リダイレクトのたびに、許可ドメイン・https・robots を確かめ直す */
  async get(target: string): Promise<FetchResult> {
    let current = target;
    for (let hop = 0; ; hop++) {
      if (sourceUrlReason(current) !== null) return { ok: false, reason: "not-allowed" };
      const url = new URL(current);
      const rules = await this.rulesForHost(url);
      if (rules === null) return { ok: false, reason: "robots-unreachable" };
      if (!isAllowed(rules, `${url.pathname}${url.search}`)) return { ok: false, reason: "robots-disallowed" };
      const r = await this.request(url, true);
      if (!r.ok) return { ok: false, reason: r.reason };
      if (REDIRECT_STATUSES.has(r.status)) {
        const location = r.headers.get("location");
        if (location === null) return { ok: false, reason: "http-error", status: r.status };
        if (hop >= this.options.maxRedirects) return { ok: false, reason: "too-many-redirects" };
        try {
          current = new URL(location, url).toString();
        } catch {
          return { ok: false, reason: "not-allowed" };
        }
        continue;
      }
      if (r.status < 200 || r.status >= 300 || r.body === null) {
        return { ok: false, reason: "http-error", status: r.status };
      }
      return {
        ok: true,
        finalUrl: url.toString(),
        body: r.body,
        hash: sha256(r.body),
        contentType: r.headers.get("content-type"),
        lastModified: r.headers.get("last-modified"),
      };
    }
  }
}
