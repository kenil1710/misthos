import { getDb } from "@misthos/db";
import { ContextReadInput } from "@misthos/shared";
import { requestContextRead } from "@/lib/server/context";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { enqueue } from "@/lib/server/queue";
import { allow } from "@/lib/server/rate-limit";
import { getOwnerSession } from "@/lib/server/session";

/**
 * Owner: ask the agent to read the program's context (text + links) and draft what it understood. The read runs in
 * the worker (it holds the model key and fetches links through the SSRF guard); poll /api/owner/context/[id].
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getOwnerSession();
  if (!session) return jsonError("sign_in_required", 401);
  if (!allow(`context-read:${session.sub}`, 10, 10 * 60_000))
    return jsonError("That's a lot of reads. Wait a few minutes and try again.", 429);
  const body = ContextReadInput.safeParse(await readJson(req));
  if (!body.success)
    return jsonError(body.error.issues[0]?.message ?? "Check the description and links.", 400);
  const res = await requestContextRead(
    getDb(),
    { ownerUserId: session.sub, input: body.data },
    enqueue,
  );
  return Response.json(res);
}
