import { contributors, getDb, programs } from "@misthos/db";
import { Slug } from "@misthos/shared";
import { and, eq } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { enqueue } from "@/lib/server/queue";
import { getContributorSession } from "@/lib/server/session";
import { contributorSubmissionItems } from "@/lib/server/contributor-submissions";
import { createSubmission } from "@/lib/server/submissions";

const Body = z.object({ programSlug: Slug, url: z.string().min(1).max(2000) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("bad_origin", 403);
  const session = await getContributorSession();
  if (!session) return jsonError("Sign in with X first.", 401);
  const body = Body.safeParse(await readJson(req));
  if (!body.success) return jsonError("Paste a link to submit.", 400);
  const res = await createSubmission(
    getDb(),
    {
      programSlug: body.data.programSlug,
      xUserId: session.xid,
      userId: session.sub,
      url: body.data.url,
    },
    enqueue,
  );
  return Response.json(res, { status: res.ok ? 201 : 400 });
}

const Ids = z.array(z.uuid()).max(50);

/**
 * The signed-in contributor's own submissions with the latest decision, newest first. `ids=a,b` returns only those
 * (the status poll asks for in-flight items only).
 */
export async function GET(req: NextRequest) {
  const session = await getContributorSession();
  if (!session) return jsonError("sign_in_required", 401);
  const slug = Slug.safeParse(req.nextUrl.searchParams.get("program"));
  if (!slug.success) return jsonError("invalid_program", 400);
  const rawIds = req.nextUrl.searchParams.get("ids");
  const ids = rawIds === null ? undefined : Ids.safeParse(rawIds.split(",").filter(Boolean));
  if (ids && !ids.success) return jsonError("invalid_ids", 400);
  const [me] = await getDb()
    .select({ id: contributors.id })
    .from(contributors)
    .innerJoin(programs, eq(programs.id, contributors.programId))
    .where(and(eq(programs.slug, slug.data), eq(contributors.xUserId, session.xid)))
    .limit(1);
  if (!me) return Response.json({ submissions: [] });
  return Response.json(
    { submissions: await contributorSubmissionItems(me.id, ids?.data) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
