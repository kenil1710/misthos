import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * X OAuth 2.0 Authorization Code + PKCE (S256), confidential client.
 * Endpoints and parameters per docs.x.com (fundamentals/authentication/oauth-2-0, verified 2026-10-02):
 *   authorize  https://x.com/i/oauth2/authorize
 *   token      https://api.x.com/2/oauth2/token   (Basic auth, x-www-form-urlencoded)
 *   revoke     https://api.x.com/2/oauth2/revoke
 *   me         https://api.x.com/2/users/me        (scopes: tweet.read users.read)
 * We only need the identity once, so the access token is revoked right after /users/me and never stored.
 */
export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
export const X_ME_URL = "https://api.x.com/2/users/me";
export const X_SCOPES = ["tweet.read", "users.read"] as const;

type Fetch = typeof fetch;

const b64url = (buf: Buffer) => buf.toString("base64url");

export function createPkce() {
  const verifier = b64url(randomBytes(48)); // 64 chars, within RFC 7636's 43–128
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(24));
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(X_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: X_SCOPES.join(" "),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

const basicAuth = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

const TokenResponse = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
  scope: z.string().optional(),
});

export class XOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export async function exchangeCode(
  p: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  f: Fetch = fetch,
): Promise<string> {
  const res = await f(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuth(p.clientId, p.clientSecret),
    },
    body: new URLSearchParams({
      code: p.code,
      grant_type: "authorization_code",
      client_id: p.clientId,
      redirect_uri: p.redirectUri,
      code_verifier: p.verifier,
    }),
  });
  if (!res.ok) throw new XOAuthError("token exchange failed", res.status);
  const parsed = TokenResponse.safeParse(await res.json());
  if (!parsed.success) throw new XOAuthError("unexpected token response");
  return parsed.data.access_token;
}

export const XMe = z.object({
  data: z.object({
    id: z.string().regex(/^\d+$/),
    username: z.string().min(1),
    name: z.string().optional(),
    created_at: z.string().optional(),
    verified: z.boolean().optional(),
    public_metrics: z
      .object({ followers_count: z.number(), following_count: z.number() })
      .partial()
      .passthrough()
      .optional(),
  }),
});
export type XMe = z.infer<typeof XMe>["data"];

export async function fetchMe(accessToken: string, f: Fetch = fetch): Promise<XMe> {
  const url = new URL(X_ME_URL);
  url.searchParams.set("user.fields", "created_at,public_metrics,verified");
  const res = await f(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new XOAuthError("users/me failed", res.status);
  const parsed = XMe.safeParse(await res.json());
  if (!parsed.success) throw new XOAuthError("unexpected users/me response");
  return parsed.data.data;
}

/** Best effort: a failed revoke must not block sign-in (the token expires in 2h anyway). */
export async function revokeToken(
  p: { token: string; clientId: string; clientSecret: string },
  f: Fetch = fetch,
): Promise<boolean> {
  try {
    const res = await f(X_REVOKE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuth(p.clientId, p.clientSecret),
      },
      body: new URLSearchParams({
        token: p.token,
        token_type_hint: "access_token",
        client_id: p.clientId,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Only same-origin relative paths: blocks open redirects like //evil.com or /\evil.com. */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\"))
    return fallback;
  try {
    const u = new URL(next, "http://local.invalid");
    return u.origin === "http://local.invalid" ? `${u.pathname}${u.search}` : fallback;
  } catch {
    return fallback;
  }
}
