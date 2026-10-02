import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { cookieOptions, signToken } from "@/lib/server/session";
import { buildAuthorizeUrl, createPkce, safeNextPath } from "@/lib/server/x-oauth";
import { X_FLOW_COOKIE, X_FLOW_TTL_SECONDS, xRedirectUri } from "@/lib/server/x-flow";

/** Begin Sign in with X. `next` is where to land afterwards (same-origin paths only). */
export async function GET(req: NextRequest) {
  const { verifier, challenge, state } = createPkce();
  const next = safeNextPath(req.nextUrl.searchParams.get("next"));
  const flow = await signToken({ state, verifier, next }, X_FLOW_TTL_SECONDS);
  const res = NextResponse.redirect(
    buildAuthorizeUrl({
      clientId: env().X_CLIENT_ID,
      redirectUri: xRedirectUri(),
      state,
      challenge,
    }),
  );
  res.cookies.set(X_FLOW_COOKIE, flow, {
    ...cookieOptions(X_FLOW_TTL_SECONDS),
    path: "/api/auth/x",
  });
  return res;
}
