import { jsonError } from "@/lib/server/http";
import { decisionRecord } from "@/lib/server/public";

/** Public: the exact canonical record behind a decision hash (what gets hashed and signed). */
export async function GET(_req: Request, ctx: RouteContext<"/api/public/decisions/[hash]">) {
  const json = await decisionRecord((await ctx.params).hash.toLowerCase());
  if (!json) return jsonError("not_found", 404);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
