import { getDb, type DbLike } from "@misthos/db";
import { z } from "zod";
import { requestAppeal } from "@/lib/server/appeals";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { allow } from "@/lib/server/rate-limit";
import { getContributorSession } from "@/lib/server/session";

const Body = z.object({ note: z.string().trim().min(1, "Say briefly why.").max(280) });

/**
 * Contributor: "Ask for a second look" at a rejected or partial decision. Once per submission; the owner sees it
 * under "Needs you" and answers with a signed decision of their own.
 */
export async function POST(
  req: Request,
  ctx: RouteContext<"/api/contributor/submissions/[id]/appeal">,
) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getContributorSession();
  if (!session) return jsonError("Sign in with X first.", 401);
  if (!allow(`appeal:${session.sub}`, 3, 60_000))
    return jsonError("Too many requests at once. Wait a minute and try again.", 429);
  const id = (await ctx.params).id;
  if (!z.uuid().safeParse(id).success) return jsonError("not_found", 404);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError(body.error.issues[0]?.message ?? "Add a short note.", 400);
  const res = await requestAppeal(getDb() as unknown as DbLike, {
    userId: session.sub,
    submissionId: id,
    note: body.data.note,
  });
  if (!res.ok) return jsonError(res.error, res.status);
  return Response.json({ ok: true }, { status: 201 });
}
