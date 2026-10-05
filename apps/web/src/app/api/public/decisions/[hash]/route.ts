import { jsonError } from "@/lib/server/http";
import { decisionRecord } from "@/lib/server/public";
import { allow, clientKey } from "@/lib/server/rate-limit";

/**
 * Public: the exact canonical record behind a decision hash (what gets hashed and signed). The body is byte-for-byte
 * what was hashed; the agent's signature over the hash and the signer address come as headers.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/public/decisions/[hash]">) {
  if (!allow(`decision:${clientKey(req)}`, 120, 60_000))
    return jsonError("Too many requests. Wait a minute and try again.", 429);
  const d = await decisionRecord((await ctx.params).hash.toLowerCase());
  if (!d) return jsonError("not_found", 404);
  return new Response(d.json, {
    headers: {
      "X-Decision-Signature": d.signature,
      "X-Decision-Signer": d.signer,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
