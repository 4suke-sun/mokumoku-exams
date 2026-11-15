import { createSign } from "node:crypto";
import { createPrivateKeyLoader, readSsmParameter } from "@/lib/push/vapid.ts";
import type { FeedbackIssue } from "./issue.ts";

// 送信の内容を、このリポジトリ専用の GitHub App として Issue に起票する(docs/app/specs/feedback.md の「GitHub App」)。
// 秘密鍵は SSM Parameter Store の SecureString に置き、環境変数にはパラメーターの名前だけが入る(docs/app/infra.md)。
// 秘密鍵の値、JWT、インストールのトークンの値と、失敗の原因は、ログにも例外のメッセージにも出さない。

/** 環境変数から読む、App の ID、インストールの ID、秘密鍵のパラメーターの名前 */
export type GithubAppSettings = { appId: string; installationId: string; privateKeyParameter: string };

/** 起票先のリポジトリ */
export type IssueTarget = { owner: string; repo: string };

/** Issue を起票する(テストで差し替える) */
export type IssueCreator = (issue: FeedbackIssue) => Promise<void>;

/** GitHub の API の呼び出しが失敗した。値も原因も持たない */
export class GithubUnavailableError extends Error {
  constructor() {
    super("GitHub の API を呼べません。");
    this.name = "GithubUnavailableError";
  }
}

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2026-03-10";
/** JWT の有効期限(GitHub の上限は 10 分) */
const JWT_LIFETIME_SECONDS = 9 * 60;
/** 時計のずれに備えて、発行の時刻を前にずらす(GitHub の推奨は 60 秒) */
const JWT_BACKDATE_SECONDS = 60;
/** インストールのトークンを、切れる前のこの時間までは使い回す */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const NUMERIC_ID = /^[0-9]{1,20}$/;

/** 環境変数から App の設定を読む。3 つそろっていない、または ID が数字でなければ null(起票しない)。 */
export function readGithubApp(env: Record<string, string | undefined>): GithubAppSettings | null {
  const {
    FEEDBACK_GITHUB_APP_ID: appId,
    FEEDBACK_GITHUB_INSTALLATION_ID: installationId,
    FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER: privateKeyParameter,
  } = env;
  if (!appId || !installationId || !privateKeyParameter) return null;
  if (!NUMERIC_ID.test(appId) || !NUMERIC_ID.test(installationId)) return null;
  return { appId, installationId, privateKeyParameter };
}

/** リポジトリの URL(`https://github.com/<持ち主>/<名前>`)から、起票先を取る */
export function issueTargetOf(repositoryUrl: string): IssueTarget {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(repositoryUrl);
  if (!match?.[1] || !match[2]) throw new Error("リポジトリの URL の形が違います。");
  return { owner: match[1], repo: match[2] };
}

const base64url = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** App として認証する JWT(RS256)を作る。署名は Node の標準の crypto で行う。 */
export function createAppJwt(appId: string, privateKey: string, nowMs: number): string {
  const now = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iat: now - JWT_BACKDATE_SECONDS, exp: now + JWT_LIFETIME_SECONDS, iss: appId }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** 秘密鍵を読めない(`createPrivateKeyLoader` が、値と原因を捨ててこの例外にする) */
const keyUnavailable = () => new GithubUnavailableError();

/** プロセスで共有する、App の秘密鍵の読み出し */
export const loadGithubAppPrivateKey = createPrivateKeyLoader(readSsmParameter, keyUnavailable);

/**
 * Issue を起票する関数を作る。インストールのトークンは、起票先のリポジトリ 1 つと、Issues の書き込みに絞って発行し、
 * 切れる 5 分前までは、プロセスの間で使い回す。失敗は、原因を捨てて `GithubUnavailableError` にする。
 */
export function createGithubIssueCreator(options: {
  settings: GithubAppSettings;
  target: IssueTarget;
  loadKey?: (name: string) => Promise<string>;
  fetch?: Fetch;
  now?: () => number;
}): IssueCreator {
  const { settings, target } = options;
  const loadKey = options.loadKey ?? loadGithubAppPrivateKey;
  const call = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | undefined;

  const headers = (authorization: string) => ({
    accept: "application/vnd.github+json",
    authorization: `Bearer ${authorization}`,
    "content-type": "application/json",
    "user-agent": "mokumoku-exams-feedback",
    "x-github-api-version": API_VERSION,
  });

  async function installationToken(): Promise<string> {
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > now()) return cached.token;
    const jwt = createAppJwt(settings.appId, await loadKey(settings.privateKeyParameter), now());
    const response = await call(`${GITHUB_API}/app/installations/${settings.installationId}/access_tokens`, {
      method: "POST",
      headers: headers(jwt),
      body: JSON.stringify({ repositories: [target.repo], permissions: { issues: "write" } }),
    });
    if (response.status !== 201) throw new GithubUnavailableError();
    const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
    const expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : Number.NaN;
    if (typeof body.token !== "string" || !body.token || Number.isNaN(expiresAt)) throw new GithubUnavailableError();
    cached = { token: body.token, expiresAt };
    return body.token;
  }

  return async (issue) => {
    try {
      const token = await installationToken();
      const response = await call(`${GITHUB_API}/repos/${target.owner}/${target.repo}/issues`, {
        method: "POST",
        headers: headers(token),
        body: JSON.stringify({ title: issue.title, body: issue.body, labels: issue.labels }),
      });
      // 認証が切れていたときに備えて、次はトークンを発行し直す
      if (response.status === 401) cached = undefined;
      if (response.status !== 201) throw new GithubUnavailableError();
    } catch {
      throw new GithubUnavailableError();
    }
  };
}
