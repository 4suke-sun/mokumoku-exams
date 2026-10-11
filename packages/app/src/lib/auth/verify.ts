import { createPublicKey, type KeyObject, verify } from "node:crypto";
import { z } from "zod";

/** サーバー側で検証済みの利用者。認可の判断は、この `sub` だけで行う(クライアントから受け取った値は使わない)。 */
export type VerifiedUser = { sub: string; email?: string };

/** ID トークンの検証の境界。本番は Cognito の公開鍵、手元の開発とテストでは差し替える。 */
export interface TokenVerifier {
  /** 有効な ID トークンなら利用者を返す。そうでなければ null(理由は区別しない)。 */
  verifyIdToken(token: string): Promise<VerifiedUser | null>;
}

/** `sub` として受け付ける形。DynamoDB のキーに使うため、区切りの `#` などを含められない。 */
export const SUB_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

const MAX_TOKEN_LENGTH = 8192;
const JWKS_TTL_MS = 60 * 60 * 1000;
/** 未知の鍵 ID が来ても、公開鍵の再取得はこの間隔より頻繁には行わない */
const JWKS_REFETCH_MIN_MS = 60 * 1000;
const JWKS_TIMEOUT_MS = 3000;

const JwksSchema = z.object({
  keys: z.array(
    z.looseObject({ kid: z.string(), kty: z.string(), n: z.string().optional(), e: z.string().optional() }),
  ),
});

const HeaderSchema = z.object({ alg: z.literal("RS256"), kid: z.string().min(1).max(128) });
const ClaimsSchema = z.object({
  iss: z.string(),
  aud: z.string(),
  token_use: z.string(),
  exp: z.number(),
  sub: z.string().regex(SUB_PATTERN),
  email: z.string().max(254).optional(),
});

type Options = {
  region: string;
  userPoolId: string;
  clientId: string;
  now?: () => number;
  /** 公開鍵の一覧を取りに行く関数。テストで差し替える。 */
  fetchJwks?: (url: string) => Promise<unknown>;
};

async function defaultFetchJwks(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) });
  if (!response.ok) throw new Error("jwks-unavailable");
  return response.json();
}

function decodeJson(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/**
 * Cognito の ID トークンを検証する。署名(RS256)・発行元・クライアント・用途・有効期限を確かめる。
 * 公開鍵は Cognito の JWKS から取り、メモリに保つ。取得できないときは、拒否する(通す側には倒さない)。
 */
export function createCognitoVerifier(options: Options): TokenVerifier {
  const now = options.now ?? Date.now;
  const fetchJwks = options.fetchJwks ?? defaultFetchJwks;
  const issuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.userPoolId}`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;

  let keys = new Map<string, KeyObject>();
  let fetchedAt = Number.NEGATIVE_INFINITY;

  async function refreshKeys(): Promise<void> {
    fetchedAt = now();
    const parsed = JwksSchema.parse(await fetchJwks(jwksUrl));
    const next = new Map<string, KeyObject>();
    for (const jwk of parsed.keys) {
      if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) continue;
      next.set(jwk.kid, createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" }));
    }
    keys = next;
  }

  async function keyFor(kid: string): Promise<KeyObject | undefined> {
    const age = now() - fetchedAt;
    if (age > JWKS_TTL_MS || (!keys.has(kid) && age > JWKS_REFETCH_MIN_MS)) {
      try {
        await refreshKeys();
      } catch {
        // 取得できなければ、手元にある鍵だけで判断する(なければ拒否になる)
      }
    }
    return keys.get(kid);
  }

  return {
    async verifyIdToken(token) {
      try {
        if (token.length > MAX_TOKEN_LENGTH) return null;
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

        const header = HeaderSchema.safeParse(decodeJson(headerPart));
        if (!header.success) return null;
        const key = await keyFor(header.data.kid);
        if (!key) return null;

        const signed = Buffer.from(`${headerPart}.${payloadPart}`);
        if (!verify("RSA-SHA256", signed, key, Buffer.from(signaturePart, "base64url"))) return null;

        const claims = ClaimsSchema.safeParse(decodeJson(payloadPart));
        if (!claims.success) return null;
        const { iss, aud, token_use, exp, sub, email } = claims.data;
        if (iss !== issuer || aud !== options.clientId || token_use !== "id") return null;
        if (exp * 1000 <= now()) return null;
        return { sub, email };
      } catch {
        return null;
      }
    },
  };
}
