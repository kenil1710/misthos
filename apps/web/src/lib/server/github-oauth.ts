import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * "Connect GitHub": OAuth web flow with state and PKCE (S256), no scopes (public profile only).
 *   authorize  https://github.com/login/oauth/authorize
 *   token      https://github.com/login/oauth/access_token   (JSON via Accept header)
 *   user       https://api.github.com/user
 *   revoke     DELETE https://api.github.com/applications/{client_id}/token   (Basic client_id:client_secret)
 * We only need the account id and login once, so the token is revoked right after and never stored.
 */
export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_USER_URL = "https://api.github.com/user";

type Fetch = typeof fetch;

export class GithubOAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function createGithubFlow() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  return { verifier, challenge, state };
}

export function buildGithubAuthorizeUrl(p: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    // No scope: read-only access to the public profile, which is all we need.
    scope: "",
    allow_signup: "false",
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

const TokenResponse = z.object({ access_token: z.string().min(1) });

export async function exchangeGithubCode(
  p: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  f: Fetch = fetch,
): Promise<string> {
  const res = await f(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: p.clientId,
      client_secret: p.clientSecret,
      code: p.code,
      redirect_uri: p.redirectUri,
      code_verifier: p.verifier,
    }),
  });
  if (!res.ok) throw new GithubOAuthError("token exchange failed", res.status);
  const parsed = TokenResponse.safeParse(await res.json());
  // GitHub answers 200 with {"error": ...} for bad codes.
  if (!parsed.success) throw new GithubOAuthError("token exchange refused");
  return parsed.data.access_token;
}

export const GithubUser = z.object({ id: z.number().int().positive(), login: z.string().min(1) });
export type GithubUser = z.infer<typeof GithubUser>;

export async function fetchGithubUser(token: string, f: Fetch = fetch): Promise<GithubUser> {
  const res = await f(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "misthos",
    },
  });
  if (!res.ok) throw new GithubOAuthError("user lookup failed", res.status);
  const parsed = GithubUser.safeParse(await res.json());
  if (!parsed.success) throw new GithubOAuthError("unexpected user response");
  return parsed.data;
}

/** Best effort: revoke the token so it can't be used again (it isn't stored either way). */
export async function revokeGithubToken(
  p: { token: string; clientId: string; clientSecret: string },
  f: Fetch = fetch,
): Promise<boolean> {
  try {
    const res = await f(
      `https://api.github.com/applications/${encodeURIComponent(p.clientId)}/token`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${Buffer.from(`${p.clientId}:${p.clientSecret}`).toString("base64")}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "misthos",
        },
        body: JSON.stringify({ access_token: p.token }),
      },
    );
    return res.status === 204;
  } catch {
    return false;
  }
}
