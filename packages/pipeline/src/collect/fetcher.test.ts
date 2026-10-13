import { describe, expect, it } from "vitest";
import { Fetcher, sha256 } from "./fetcher.ts";
import { fakeNet, fixture, ROBOTS_OK, testFetchConfig } from "./test-helpers.ts";

const DOCS = "https://docs.aws.amazon.com";
const ROBOTS = `${DOCS}/robots.txt`;

describe("取得器", () => {
  it("許可したドメインの https_本文とハッシュを返し、取得元の User-Agent を送る", async () => {
    const body = fixture("guide.html");
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/guide/a.html`]: { body, headers: { "last-modified": "Mon, 01 Jun 2026 00:00:00 GMT" } },
    });
    const r = await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/guide/a.html`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hash).toBe(sha256(Buffer.from(body)));
    expect(r.lastModified).toContain("2026");
    expect(net.userAgents.every((ua) => ua === testFetchConfig.userAgent)).toBe(true);
  });

  it.each([
    ["http://docs.aws.amazon.com/x"],
    ["https://unlisted.example.com/x"],
    ["https://docs.aws.amazon.com.example.com/x"],
    ["https://user@docs.aws.amazon.com/x"],
    ["https://docs.aws.amazon.com:8443/x"],
  ])("許可外・https 以外_通信せずに not-allowed を返す: %s", async (url) => {
    const net = fakeNet({});
    expect(await new Fetcher(testFetchConfig, net.deps).get(url)).toEqual({ ok: false, reason: "not-allowed" });
    expect(net.requests).toEqual([]);
  });

  it("リダイレクト_行き先ごとに許可ドメインを確かめ直し、許可外へは行かない", async () => {
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/a`]: { status: 302, headers: { location: "/b" } },
      [`${DOCS}/b`]: { status: 301, headers: { location: "https://unlisted.example.com/c" } },
    });
    expect(await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/a`)).toEqual({ ok: false, reason: "not-allowed" });
    expect(net.requests).not.toContain("https://unlisted.example.com/c");
  });

  it("リダイレクト_http へは行かない", async () => {
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/a`]: { status: 302, headers: { location: "http://docs.aws.amazon.com/b" } },
    });
    expect(await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/a`)).toEqual({ ok: false, reason: "not-allowed" });
  });

  it("リダイレクト_回数の上限を超えたら止める", async () => {
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/r0`]: { status: 302, headers: { location: "/r1" } },
      [`${DOCS}/r1`]: { status: 302, headers: { location: "/r2" } },
      [`${DOCS}/r2`]: { status: 302, headers: { location: "/r3" } },
      [`${DOCS}/r3`]: { body: "end" },
    });
    expect(await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/r0`)).toEqual({
      ok: false,
      reason: "too-many-redirects",
    });
    expect(net.requests).not.toContain(`${DOCS}/r3`);
  });

  it("リダイレクト_上限の内なら、行き先の本文を返す", async () => {
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/r0`]: { status: 308, headers: { location: "/r1" } },
      [`${DOCS}/r1`]: { body: "end" },
    });
    const r = await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/r0`);
    expect(r.ok && r.finalUrl).toBe(`${DOCS}/r1`);
  });

  it("本文の大きさ_宣言でも実際の大きさでも、上限を超えたら止める", async () => {
    const big = Buffer.alloc(testFetchConfig.maxBytes + 1, 0x61);
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/declared`]: { body: "x", headers: { "content-length": String(testFetchConfig.maxBytes + 1) } },
      [`${DOCS}/actual`]: { body: big },
    });
    const fetcher = new Fetcher(testFetchConfig, net.deps);
    expect(await fetcher.get(`${DOCS}/declared`)).toEqual({ ok: false, reason: "too-large" });
    expect(await fetcher.get(`${DOCS}/actual`)).toEqual({ ok: false, reason: "too-large" });
  });

  it("タイムアウト_止めて timeout を返す", async () => {
    const net = fakeNet({ [ROBOTS]: ROBOTS_OK, [`${DOCS}/slow`]: { hang: true } });
    expect(await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/slow`)).toEqual({ ok: false, reason: "timeout" });
  });

  it("HTTP の誤りと通信の失敗_理由コードで返す", async () => {
    const net = fakeNet({ [ROBOTS]: ROBOTS_OK, [`${DOCS}/gone`]: { status: 410 }, [`${DOCS}/down`]: { error: true } });
    const fetcher = new Fetcher(testFetchConfig, net.deps);
    expect(await fetcher.get(`${DOCS}/gone`)).toEqual({ ok: false, reason: "http-error", status: 410 });
    expect(await fetcher.get(`${DOCS}/down`)).toEqual({ ok: false, reason: "network-error" });
  });

  it("robots.txt_禁止されたパスは取得しない。自分の製品名の組を優先する", async () => {
    const net = fakeNet({ [ROBOTS]: { body: fixture("robots.txt") }, [`${DOCS}/private/a`]: { body: "ok" } });
    const fetcher = new Fetcher(testFetchConfig, net.deps);
    expect(await fetcher.get(`${DOCS}/guide/private/a`)).toEqual({ ok: false, reason: "robots-disallowed" });
    // 製品名の組があるので、* の組の Disallow: /private/ は使わない
    expect((await fetcher.get(`${DOCS}/private/a`)).ok).toBe(true);
    expect(net.requests).not.toContain(`${DOCS}/guide/private/a`);
    // robots.txt は、ホストごとに 1 回だけ取得する
    expect(net.requests.filter((u) => u === ROBOTS)).toHaveLength(1);
  });

  it("robots.txt が取得できない(5xx)_すべて禁止として扱う", async () => {
    const net = fakeNet({ [ROBOTS]: { status: 503 }, [`${DOCS}/a`]: { body: "ok" } });
    expect(await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/a`)).toEqual({
      ok: false,
      reason: "robots-unreachable",
    });
    expect(net.requests).not.toContain(`${DOCS}/a`);
  });

  it("レート制限_同じホストへの取得の開始が、決めた間隔だけ空く", async () => {
    const net = fakeNet({
      [ROBOTS]: ROBOTS_OK,
      [`${DOCS}/1`]: { body: "1" },
      [`${DOCS}/2`]: { body: "2" },
      [`${DOCS}/3`]: { body: "3" },
    });
    const fetcher = new Fetcher(testFetchConfig, net.deps);
    await Promise.all([fetcher.get(`${DOCS}/1`), fetcher.get(`${DOCS}/2`), fetcher.get(`${DOCS}/3`)]);
    const gaps = net.startTimes.slice(1).map((t, i) => t - (net.startTimes[i] ?? 0));
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(testFetchConfig.perHostIntervalMs);
  });

  it("失敗の結果_本文や URL の値を含まない", async () => {
    const net = fakeNet({ [ROBOTS]: ROBOTS_OK, [`${DOCS}/e`]: { status: 500, body: "secret-body-text" } });
    const r = await new Fetcher(testFetchConfig, net.deps).get(`${DOCS}/e`);
    expect(JSON.stringify(r)).not.toContain("secret-body-text");
    expect(JSON.stringify(r)).not.toContain("docs.aws");
  });
});
