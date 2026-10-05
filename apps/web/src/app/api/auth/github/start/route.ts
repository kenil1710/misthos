import { type NextRequest, NextResponse } from "next/server";
import { appOrigin, env } from "@/lib/server/env";
import {
  GITHUB_FLOW_COOKIE,
  GITHUB_FLOW_TTL_SECONDS,
  githubRedirectUri,
} from "@/lib/server/github-flow";
import { buildGithubAuthorizeUrl, createGithubFlow } from "@/lib/server/github-oauth";
import { cookieOptions, getContributorSession, signToken } from "@/lib/server/session";
import { safeNextPath } from "@/lib/server/x-oauth";
import { allow, clientKey } from "@/lib/server/rate-limit";

const TTL = GITHUB_FLOW_TTL_SECONDS;

/** Begin "Connect GitHub" for the signed-in contributor. `next` is where to land afterwards. */
export async function GET(req: NextRequest) {
  if (!allow(`github-start:${clientKey(req)}`, 20, 60_000))
    return new Response("Too many attempts. Wait a minute and try again.", { status: 429 });
  const next = safeNextPath(req.nextUrl.searchParams.get("next"), "/");
  const session = await getContributorSession();
  const back = (reason: string) => {
    const url = new URL(next, appOrigin());
    url.searchParams.set("github_error", reason);
    return NextResponse.redirect(url);
  };
  if (!session) return back("sign_in_required");
  const { GITHUB_OAUTH_CLIENT_ID: clientId } = env();
  if (!clientId) return back("not_configured");
  const { verifier, challenge, state } = createGithubFlow();
  const flow = await signToken({ state, verifier, next, sub: session.sub }, TTL);
  const res = NextResponse.redirect(
    buildGithubAuthorizeUrl({ clientId, redirectUri: githubRedirectUri(), state, challenge }),
  );
  res.cookies.set(GITHUB_FLOW_COOKIE, flow, { ...cookieOptions(TTL), path: "/api/auth/github" });
  return res;
}
