import { apiUsage, getDb, type DbLike } from "@misthos/db";
import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { appOrigin, env } from "@/lib/server/env";
import { connectGithub } from "@/lib/server/github-identity";
import {
  exchangeGithubCode,
  fetchGithubUser,
  GithubOAuthError,
  revokeGithubToken,
} from "@/lib/server/github-oauth";
import { getContributorSession, verifyToken } from "@/lib/server/session";
import { safeNextPath } from "@/lib/server/x-oauth";
import { GITHUB_FLOW_COOKIE, githubRedirectUri } from "@/lib/server/github-flow";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** GitHub sends the contributor back here (registered as /api/auth/github/callback). */
export async function GET(req: NextRequest) {
  const flow = await verifyToken(req.cookies.get(GITHUB_FLOW_COOKIE)?.value ?? "");
  const next = safeNextPath(typeof flow?.next === "string" ? flow.next : null, "/");
  const done = (param: string, value: string) => {
    const url = new URL(next, appOrigin());
    url.searchParams.set(param, value);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: GITHUB_FLOW_COOKIE, path: "/api/auth/github" });
    return res;
  };
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return done("github_error", "denied");
  const code = params.get("code");
  const state = params.get("state");
  if (
    !flow ||
    typeof flow.state !== "string" ||
    typeof flow.verifier !== "string" ||
    !code ||
    !state
  )
    return done("github_error", "expired");
  if (!same(state, flow.state)) return done("github_error", "state_mismatch");
  // The flow is bound to the contributor who started it.
  const session = await getContributorSession();
  if (!session || session.sub !== flow.sub) return done("github_error", "sign_in_required");

  const { GITHUB_OAUTH_CLIENT_ID: clientId, GITHUB_OAUTH_CLIENT_SECRET: clientSecret } = env();
  if (!clientId || !clientSecret) return done("github_error", "not_configured");
  let gh;
  try {
    const token = await exchangeGithubCode({
      code,
      verifier: flow.verifier,
      clientId,
      clientSecret,
      redirectUri: githubRedirectUri(),
    });
    gh = await fetchGithubUser(token);
    await revokeGithubToken({ token, clientId, clientSecret });
  } catch (e) {
    console.error(
      "github oauth failed",
      e instanceof GithubOAuthError ? { msg: e.message, status: e.status } : "unexpected",
    );
    return done("github_error", "github_unavailable");
  }
  const db = getDb() as unknown as DbLike;
  await db.insert(apiUsage).values({ provider: "github", endpoint: "GET /user (oauth)", units: 1 });
  const res = await connectGithub(db, { userId: session.sub, github: gh });
  if (!res.ok) return done("github_error", res.error);
  return done("github", "connected");
}
