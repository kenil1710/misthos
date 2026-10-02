import { contributors, users, type DbLike } from "@misthos/db";
import { testDb } from "@misthos/db/testing";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertXUser } from "@/lib/server/contributors";
import { connectGithub } from "@/lib/server/github-identity";
import {
  buildGithubAuthorizeUrl,
  createGithubFlow,
  exchangeGithubCode,
  fetchGithubUser,
  GITHUB_TOKEN_URL,
  GithubOAuthError,
  revokeGithubToken,
} from "@/lib/server/github-oauth";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GitHub OAuth", () => {
  it("asks for no scopes, binds state and PKCE, and uses the registered callback", () => {
    const { verifier, challenge, state } = createGithubFlow();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const url = new URL(
      buildGithubAuthorizeUrl({
        clientId: "cid",
        redirectUri: "http://localhost:3000/api/auth/github/callback",
        state,
        challenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/github/callback",
    );
    expect(url.searchParams.get("state")).toBe(state);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges the code, reads the profile, and treats GitHub's 200-with-error as a failure", async () => {
    const f = vi.fn(async () => json({ access_token: "gho_x", token_type: "bearer" }));
    expect(
      await exchangeGithubCode(
        { code: "c", verifier: "v", clientId: "cid", clientSecret: "s", redirectUri: "r" },
        f as never,
      ),
    ).toBe("gho_x");
    expect((f.mock.calls[0] as unknown[])[0]).toBe(GITHUB_TOKEN_URL);
    const bad = vi.fn(async () => json({ error: "bad_verification_code" }));
    await expect(
      exchangeGithubCode(
        { code: "c", verifier: "v", clientId: "cid", clientSecret: "s", redirectUri: "r" },
        bad as never,
      ),
    ).rejects.toBeInstanceOf(GithubOAuthError);
    const user = vi.fn(async () =>
      json({ id: 4242, login: "alice-dev", email: "ignored@example.com" }),
    );
    expect(await fetchGithubUser("gho_x", user as never)).toEqual({ id: 4242, login: "alice-dev" });
  });

  it("revokes the token right after use (DELETE with client credentials)", async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    expect(
      await revokeGithubToken({ token: "gho_x", clientId: "cid", clientSecret: "s" }, f as never),
    ).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/applications/cid/token");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ access_token: "gho_x" });
  });
});

describe("connecting GitHub to a contributor", () => {
  let ctx: Awaited<ReturnType<typeof testDb>>;
  let db: DbLike;
  beforeEach(async () => {
    ctx = await testDb();
    db = ctx.db as unknown as DbLike;
  });
  afterEach(async () => {
    await ctx.client.close();
  });

  it("stores the verified id on the user, and one GitHub account can't be claimed by a second user", async () => {
    const alice = await upsertXUser(db, { id: "1", username: "alice" });
    const mallory = await upsertXUser(db, { id: "2", username: "mallory" });
    expect(
      await connectGithub(db, { userId: alice.id, github: { id: 4242, login: "alice-dev" } }),
    ).toMatchObject({
      ok: true,
    });
    const [u] = await db.select().from(users).where(eq(users.id, alice.id));
    expect(u).toMatchObject({ githubUserId: "4242", githubLogin: "alice-dev" });
    expect(
      await connectGithub(db, { userId: mallory.id, github: { id: 4242, login: "alice-dev" } }),
    ).toEqual({
      ok: false,
      error: "github_in_use",
    });
    expect(await db.select().from(contributors)).toEqual([]);
  });
});
