import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  createPkce,
  exchangeCode,
  fetchMe,
  revokeToken,
  safeNextPath,
  X_ME_URL,
  X_REVOKE_URL,
  X_TOKEN_URL,
  XOAuthError,
} from "@/lib/server/x-oauth";
import me from "./fixtures/x-users-me.json" with { type: "json" };

const creds = { clientId: "cid", clientSecret: "secret" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PKCE", () => {
  it("derives an S256 challenge from a 43–128 char verifier", () => {
    const { verifier, challenge, state } = createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(state.length).toBeGreaterThanOrEqual(32);
    expect(createPkce().verifier).not.toBe(verifier);
  });

  it("builds the authorize URL with only the scopes we need", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://m.example/api/auth/x/callback",
        state: "st",
        challenge: "ch",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://m.example/api/auth/x/callback",
      scope: "tweet.read users.read",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("token exchange", () => {
  it("posts a form with Basic auth and the verifier", async () => {
    const f = vi.fn(async () =>
      json({ access_token: "at", token_type: "bearer", scope: "tweet.read users.read" }),
    );
    const token = await exchangeCode(
      { code: "c0de", verifier: "v", redirectUri: "https://m.example/cb", ...creds },
      f as typeof fetch,
    );
    expect(token).toBe("at");
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(X_TOKEN_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("cid:secret").toString("base64")}`,
    );
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      code: "c0de",
      grant_type: "authorization_code",
      client_id: "cid",
      redirect_uri: "https://m.example/cb",
      code_verifier: "v",
    });
  });

  it("throws on X errors without leaking the response body", async () => {
    const f = vi.fn(async () =>
      json({ error: "invalid_request", error_description: "secret detail" }, 400),
    );
    await expect(
      exchangeCode({ code: "c", verifier: "v", redirectUri: "r", ...creds }, f as typeof fetch),
    ).rejects.toSatisfy(
      (e) => e instanceof XOAuthError && e.status === 400 && !e.message.includes("secret"),
    );
  });
});

describe("users/me", () => {
  it("parses the identity fields we rely on", async () => {
    const f = vi.fn(async () => json(me));
    const user = await fetchMe("at", f as typeof fetch);
    expect(user).toMatchObject({
      id: "1849012345678901234",
      username: "arc_builder",
      created_at: "2021-03-14T09:26:53.000Z",
    });
    const [url] = f.mock.calls[0]! as unknown as [URL];
    expect(url.toString()).toBe(`${X_ME_URL}?user.fields=created_at%2Cpublic_metrics%2Cverified`);
  });

  it("rejects responses without a numeric id", async () => {
    const f = vi.fn(async () => json({ data: { id: "abc", username: "x" } }));
    await expect(fetchMe("at", f as typeof fetch)).rejects.toBeInstanceOf(XOAuthError);
  });
});

describe("revoke", () => {
  it("revokes with Basic auth and never throws", async () => {
    const f = vi.fn(async () => json({ revoked: true }));
    expect(await revokeToken({ token: "at", ...creds }, f as typeof fetch)).toBe(true);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(X_REVOKE_URL);
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await revokeToken({ token: "at", ...creds }, boom as typeof fetch)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/join/arc-builders", "/join/arc-builders"],
    ["/c/arc?tab=wallet", "/c/arc?tab=wallet"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/\t/evil.com", "/"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
    [" /join/x", "/"],
    ["/c/arc#wallet", "/c/arc"],
    [null, "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
