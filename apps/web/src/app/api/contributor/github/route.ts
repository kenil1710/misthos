import { contributors, getDb } from "@misthos/db";
import { GithubLogin, Slug } from "@misthos/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/lib/server/audit";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { getProgramBySlug } from "@/lib/server/queries";
import { getContributorSession } from "@/lib/server/session";

const Body = z.object({ programSlug: Slug, githubLogin: z.union([z.literal(""), GithubLogin]) });

/**
 * Set or clear the contributor's GitHub username after joining (needed before submitting GitHub work). Logged in the
 * audit trail so owners can see changes.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getContributorSession();
  if (!session) return jsonError("sign_in_required", 401);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("invalid_github", 400);
  const program = await getProgramBySlug(body.data.programSlug);
  if (!program) return jsonError("program_not_found", 404);
  const db = getDb();
  const login = body.data.githubLogin || null;
  const updated = await db
    .update(contributors)
    .set({ githubLogin: login })
    .where(and(eq(contributors.programId, program.id), eq(contributors.userId, session.sub)))
    .returning({ id: contributors.id });
  if (!updated[0]) return jsonError("not_a_member", 404);
  await audit(db, {
    programId: program.id,
    actor: `user:${session.sub}`,
    action: "contributor.github_set",
    entity: "contributor",
    entityId: updated[0].id,
    data: { githubLogin: login },
  });
  return Response.json({ ok: true });
}
