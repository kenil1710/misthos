import { apiUsage, getDb } from "@misthos/db";
import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { audit } from "@/lib/server/audit";
import { upsertXUser } from "@/lib/server/contributors";
import { appOrigin, env } from "@/lib/server/env";
import { startSession, verifyToken } from "@/lib/server/session";
import {
  exchangeCode,
  fetchMe,
  revokeToken,
  safeNextPath,
  XOAuthError,
} from "@/lib/server/x-oauth";
import { X_FLOW_COOKIE, xRedirectUri } from "@/lib/server/x-flow";

function fail(next: string, reason: string) {
  const url = new URL(next, appOrigin());
  url.searchParams.set("x_error", reason);
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: X_FLOW_COOKIE, path: "/api/auth/x" });
  return res;
}

const eq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: NextRequest) {
  const flow = await verifyToken(req.cookies.get(X_FLOW_COOKIE)?.value ?? "");
  const next = safeNextPath(typeof flow?.next === "string" ? flow.next : null);
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return fail(next, "denied");

  const code = params.get("code");
  const state = params.get("state");
  if (
    !flow ||
    typeof flow.state !== "string" ||
    typeof flow.verifier !== "string" ||
    !code ||
    !state
  ) {
    return fail(next, "expired");
  }
  if (!eq(state, flow.state)) return fail(next, "state_mismatch");

  const { X_CLIENT_ID: clientId, X_CLIENT_SECRET: clientSecret } = env();
  let me;
  try {
    const token = await exchangeCode({
      code,
      verifier: flow.verifier,
      clientId,
      clientSecret,
      redirectUri: xRedirectUri(),
    });
    me = await fetchMe(token);
    await revokeToken({ token, clientId, clientSecret });
  } catch (e) {
    console.error(
      "x oauth failed",
      e instanceof XOAuthError ? { msg: e.message, status: e.status } : "unexpected",
    );
    return fail(next, "x_unavailable");
  }

  const db = getDb();
  await db.insert(apiUsage).values({ provider: "x", endpoint: "GET /2/users/me", units: 1 });
  const user = await upsertXUser(db, {
    id: me.id,
    username: me.username,
    name: me.name,
    createdAt: me.created_at ? new Date(me.created_at) : undefined,
  });
  await audit(db, {
    actor: `user:${user.id}`,
    action: "contributor.signed_in_x",
    entity: "user",
    entityId: user.id,
    data: { xHandle: me.username },
  });
  await startSession({ sub: user.id, kind: "contributor", xid: user.xUserId, xh: user.xHandle });

  const res = NextResponse.redirect(new URL(next, appOrigin()));
  res.cookies.delete({ name: X_FLOW_COOKIE, path: "/api/auth/x" });
  return res;
}
