import { contributors, decisions, getDb, programs, submissions } from "@misthos/db";
import { Slug } from "@misthos/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { jsonError, readJson, sameOrigin } from "@/lib/server/http";
import { enqueue } from "@/lib/server/queue";
import { getContributorSession } from "@/lib/server/session";
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

/** The signed-in contributor's own submissions with the latest decision, newest first. */
export async function GET(req: NextRequest) {
  const session = await getContributorSession();
  if (!session) return jsonError("sign_in_required", 401);
  const slug = Slug.safeParse(req.nextUrl.searchParams.get("program"));
  if (!slug.success) return jsonError("invalid_program", 400);
  const db = getDb();
  const [me] = await db
    .select({ id: contributors.id })
    .from(contributors)
    .innerJoin(programs, eq(programs.id, contributors.programId))
    .where(and(eq(programs.slug, slug.data), eq(contributors.xUserId, session.xid)))
    .limit(1);
  if (!me) return Response.json({ submissions: [] });

  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.contributorId, me.id))
    .orderBy(desc(submissions.createdAt))
    .limit(100);
  const ids = rows.map((r) => r.id);
  const decs = ids.length
    ? await db
        .select({
          submissionId: decisions.submissionId,
          summary: decisions.summary,
          decisionHash: decisions.decisionHash,
          decidedBy: decisions.decidedBy,
          flags: decisions.flagsJson,
          createdAt: decisions.createdAt,
        })
        .from(decisions)
        .where(inArray(decisions.submissionId, ids))
        .orderBy(desc(decisions.createdAt))
    : [];
  const latest = new Map<string, (typeof decs)[number]>();
  for (const d of decs) if (!latest.has(d.submissionId)) latest.set(d.submissionId, d);

  return Response.json(
    {
      submissions: rows.map((r) => {
        const d = latest.get(r.id);
        return {
          id: r.id,
          url: r.url,
          sourceType: r.sourceType,
          status: r.status,
          amount: r.amount?.toString() ?? null,
          createdAt: r.createdAt.toISOString(),
          decision: d
            ? {
                summary: d.summary,
                decisionHash: d.decisionHash,
                decidedBy: d.decidedBy,
                flags: (d.flags as { code: string; severity: string }[]).map((f) => ({
                  code: f.code,
                  severity: f.severity,
                })),
              }
            : null,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
