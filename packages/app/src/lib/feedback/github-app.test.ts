import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createAppJwt,
  createGithubIssueCreator,
  GithubUnavailableError,
  issueTargetOf,
  readGithubApp,
} from "./github-app.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const settings = { appId: "123", installationId: "456", privateKeyParameter: "/example/key" };
const target = { owner: "example", repo: "repo" };
const issue = { title: "お問い合わせ: 不具合", body: "本文", labels: ["user", "bug"] };
const NOW = Date.parse("2026-11-15T00:00:00Z");

type Call = { url: string; init: RequestInit };

/** 送った要求を記録し、経路ごとに決めた応答を返す */
function recordingFetch(replies: { token?: () => Response; issue?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/access_tokens")) {
      return (
        replies.token?.() ??
        Response.json(
          { token: "installation-token", expires_at: new Date(NOW + 60 * 60 * 1000).toISOString() },
          { status: 201 },
        )
      );
    }
    return replies.issue?.() ?? Response.json({ number: 1 }, { status: 201 });
  };
  return { calls, fetch };
}

describe("readGithubApp", () => {
  it("3 つの変数がそろう_設定を返す", () => {
    expect(
      readGithubApp({
        FEEDBACK_GITHUB_APP_ID: "123",
        FEEDBACK_GITHUB_INSTALLATION_ID: "456",
        FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER: "/example/key",
      }),
    ).toEqual(settings);
  });

  it("変数が欠ける_または ID が数字でない_null を返す", () => {
    expect(readGithubApp({ FEEDBACK_GITHUB_APP_ID: "123", FEEDBACK_GITHUB_INSTALLATION_ID: "456" })).toBeNull();
    expect(
      readGithubApp({
        FEEDBACK_GITHUB_APP_ID: "abc",
        FEEDBACK_GITHUB_INSTALLATION_ID: "456",
        FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER: "/example/key",
      }),
    ).toBeNull();
  });
});

describe("issueTargetOf", () => {
  it("リポジトリの URL_持ち主と名前を取る", () => {
    expect(issueTargetOf("https://github.com/example/repo")).toEqual(target);
  });

  it("形の違う URL_例外になる", () => {
    expect(() => issueTargetOf("https://example.com/example/repo")).toThrow();
  });
});

describe("createAppJwt", () => {
  it("App の ID と時刻_RS256 で署名され_iat は 60 秒前_exp は 10 分以内になる", () => {
    const jwt = createAppJwt("123", privateKey, NOW);
    const [header, payload, signature] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      iat: number;
      exp: number;
      iss: string;
    };
    const now = NOW / 1000;
    expect(claims.iss).toBe("123");
    expect(claims.iat).toBe(now - 60);
    expect(claims.exp).toBeGreaterThan(now);
    expect(claims.exp - now).toBeLessThanOrEqual(10 * 60);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });
});

describe("createGithubIssueCreator", () => {
  const create = (fetch: ReturnType<typeof recordingFetch>["fetch"], now = () => NOW) =>
    createGithubIssueCreator({ settings, target, loadKey: async () => privateKey, fetch, now });

  it("起票する_トークンをリポジトリ 1 つと Issues の書き込みに絞って発行し_そのトークンで起票する", async () => {
    const { calls, fetch } = recordingFetch();
    await create(fetch)(issue);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.github.com/app/installations/456/access_tokens",
      "https://api.github.com/repos/example/repo/issues",
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      repositories: ["repo"],
      permissions: { issues: "write" },
    });
    const headers = calls[1]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer installation-token");
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual(issue);
  });

  it("トークンが切れる 5 分前より前_発行し直さずに使い回す", async () => {
    const { calls, fetch } = recordingFetch();
    let now = NOW;
    const send = create(fetch, () => now);
    await send(issue);
    now = NOW + 54 * 60 * 1000;
    await send(issue);
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(1);
    now = NOW + 56 * 60 * 1000;
    await send(issue);
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(2);
  });

  it("トークンの発行が失敗する_原因を含まない GithubUnavailableError になり_起票しない", async () => {
    const { calls, fetch } = recordingFetch({ token: () => Response.json({ message: "秘密の原因" }, { status: 401 }) });
    const error = await create(fetch)(issue).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GithubUnavailableError);
    expect(String((error as Error).message)).not.toContain("秘密の原因");
    expect(calls).toHaveLength(1);
  });

  it("起票が失敗する_GithubUnavailableError になる", async () => {
    const { fetch } = recordingFetch({ issue: () => new Response("", { status: 403 }) });
    await expect(create(fetch)(issue)).rejects.toBeInstanceOf(GithubUnavailableError);
  });

  it("起票が 401 で断られる_次はトークンを発行し直す", async () => {
    let first = true;
    const { calls, fetch } = recordingFetch({
      issue: () => {
        const status = first ? 401 : 201;
        first = false;
        return new Response("{}", { status });
      },
    });
    const send = create(fetch);
    await expect(send(issue)).rejects.toBeInstanceOf(GithubUnavailableError);
    await send(issue);
    expect(calls.filter((c) => c.url.endsWith("/access_tokens"))).toHaveLength(2);
  });

  it("秘密鍵を読めない_GithubUnavailableError になり_GitHub を呼ばない", async () => {
    const { calls, fetch } = recordingFetch();
    const send = createGithubIssueCreator({
      settings,
      target,
      loadKey: async () => {
        throw new Error("読めない原因");
      },
      fetch,
      now: () => NOW,
    });
    await expect(send(issue)).rejects.toBeInstanceOf(GithubUnavailableError);
    expect(calls).toHaveLength(0);
  });
});
