import { issueNonce } from "@/lib/server/nonces";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { allow, clientKey } from "@/lib/server/rate-limit";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  // Each nonce is a database row: keep anonymous callers from filling the table.
  if (!allow(`siwe-nonce:${clientKey(req)}`, 20, 60_000))
    return jsonError("Too many sign-in attempts. Wait a minute and try again.", 429);
  const { nonce } = await issueNonce("siwe");
  return Response.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
}
